import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceInfrastructureSimulation,
  datacenters,
  filterMachines,
  findMachine,
  infrastructureSummary,
  maintenanceVendors,
  machines,
  resetInfrastructureSimulation,
} from "../src/infrastructure.js";

test("provides stable demo datacenters and machines", () => {
  assert.equal(datacenters.length, 4);
  assert.equal(machines.length, 36);
  assert.equal(new Set(machines.map((item) => item.ip)).size, machines.length);
  assert.equal(maintenanceVendors.length, 3);
  assert.ok(machines.every((item) => item.maintenance_vendor_name));
  assert.ok(maintenanceVendors.every((item) => item.contacts.length >= 2));
});

test("filters machines by datacenter, status, and keyword", () => {
  resetInfrastructureSimulation(new Date("2026-08-18T12:00:00.000Z"));
  const datacenterId = datacenters[0].id;
  const inDatacenter = filterMachines({ datacenterIds: [datacenterId] });
  assert.equal(inDatacenter.length, 9);
  assert.ok(inDatacenter.every((item) => item.datacenter_id === datacenterId));

  advanceInfrastructureSimulation({
    now: new Date("2026-08-18T12:01:00.000Z"),
    random: () => 0,
    incidentChancePerMinute: 1,
    multipleIncidentChance: 0,
  });
  const warnings = filterMachines({ status: "warning" });
  assert.equal(warnings.length, 1);
  assert.ok(warnings.every((item) => item.status === "warning"));

  const found = filterMachines({ keyword: machines[0].ip });
  assert.deepEqual(found.map((item) => item.id), [machines[0].id]);

  const byVendor = filterMachines({
    keyword: machines[0].maintenance_vendor_name,
  });
  assert.ok(byVendor.length > 0);
  assert.ok(
    byVendor.every(
      (item) =>
        item.maintenance_vendor_name === machines[0].maintenance_vendor_name,
    ),
  );
});

test("updates telemetry each minute while capping concurrent incidents", () => {
  const firstMinute = new Date("2026-08-18T12:00:00.000Z");
  const secondMinute = new Date("2026-08-18T12:01:00.000Z");
  resetInfrastructureSimulation(firstMinute);

  const transitions = advanceInfrastructureSimulation({
    now: secondMinute,
    random: () => 0,
    incidentChancePerMinute: 1,
    multipleIncidentChance: 1,
    maxActiveIncidents: 2,
  });

  assert.equal(transitions.length, 2);
  assert.equal(
    machines.filter((machine) => machine.status !== "healthy").length,
    2,
  );
  assert.ok(
    machines
      .filter((machine) => machine.status !== "offline")
      .every((machine) => machine.last_heartbeat === secondMinute.toISOString()),
  );
});

test("requires three missed minute heartbeats before marking a machine offline", () => {
  const start = new Date("2026-08-18T12:00:00.000Z");
  resetInfrastructureSimulation(start);
  let randomCall = 0;
  const chooseOffline = () => {
    randomCall += 1;
    return randomCall === 75 ? 0.9 : 0;
  };

  const first = advanceInfrastructureSimulation({
    now: new Date("2026-08-18T12:01:00.000Z"),
    random: chooseOffline,
    incidentChancePerMinute: 1,
    multipleIncidentChance: 0,
    maxActiveIncidents: 1,
  });
  const second = advanceInfrastructureSimulation({
    now: new Date("2026-08-18T12:02:00.000Z"),
    random: () => 0,
    incidentChancePerMinute: 1,
    maxActiveIncidents: 1,
  });
  const third = advanceInfrastructureSimulation({
    now: new Date("2026-08-18T12:03:00.000Z"),
    random: () => 0,
    incidentChancePerMinute: 1,
    maxActiveIncidents: 1,
  });

  assert.equal(first.length, 0);
  assert.equal(second.length, 0);
  assert.equal(third.length, 1);
  assert.equal(third[0]?.machine.status, "offline");
  assert.equal(
    third[0]?.machine.last_heartbeat,
    "2026-08-18T12:00:00.000Z",
  );
});

test("summarizes selected datacenters and finds a machine", () => {
  const selected = datacenters.slice(0, 2).map((item) => item.id);
  const summary = infrastructureSummary(selected);
  assert.equal(summary.datacenter_count, 2);
  assert.equal(summary.machine_count, 18);
  assert.equal(
    summary.healthy_count + summary.warning_count + summary.offline_count,
    summary.machine_count,
  );
  assert.equal(findMachine(machines[0].hostname)?.ip, machines[0].ip);
});
