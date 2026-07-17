import assert from "node:assert/strict";
import test from "node:test";
import {
  datacenters,
  filterMachines,
  findMachine,
  infrastructureSummary,
  machines,
} from "../src/infrastructure.js";

test("provides stable demo datacenters and machines", () => {
  assert.equal(datacenters.length, 4);
  assert.equal(machines.length, 36);
  assert.equal(new Set(machines.map((item) => item.ip)).size, machines.length);
});

test("filters machines by datacenter, status, and keyword", () => {
  const datacenterId = datacenters[0].id;
  const inDatacenter = filterMachines({ datacenterIds: [datacenterId] });
  assert.equal(inDatacenter.length, 9);
  assert.ok(inDatacenter.every((item) => item.datacenter_id === datacenterId));

  const warnings = filterMachines({ status: "warning" });
  assert.ok(warnings.length > 0);
  assert.ok(warnings.every((item) => item.status === "warning"));

  const found = filterMachines({ keyword: machines[0].ip });
  assert.deepEqual(found.map((item) => item.id), [machines[0].id]);
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
