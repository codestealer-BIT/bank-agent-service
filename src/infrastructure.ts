export type MachineStatus = "healthy" | "warning" | "offline";

export type Datacenter = {
  id: string;
  name: string;
  city: string;
  operator: string;
};

export type Machine = {
  id: string;
  ip: string;
  hostname: string;
  datacenter_id: string;
  datacenter_name: string;
  rack: string;
  role: string;
  os: string;
  status: MachineStatus;
  cpu_percent: number;
  memory_percent: number;
  last_heartbeat: string;
};

export const datacenters: Datacenter[] = [
  {
    id: "dc-shanghai-01",
    name: "上海一号机房",
    city: "上海",
    operator: "澄川银行",
  },
  {
    id: "dc-beijing-01",
    name: "北京核心机房",
    city: "北京",
    operator: "澄川银行",
  },
  {
    id: "dc-shenzhen-01",
    name: "深圳灾备机房",
    city: "深圳",
    operator: "澄川银行",
  },
  {
    id: "dc-chengdu-01",
    name: "成都数据机房",
    city: "成都",
    operator: "澄川银行",
  },
];

const roles = ["核心交易", "网银应用", "数据库", "缓存", "监控", "日志分析"];
const systems = ["Rocky Linux 9", "Ubuntu 22.04", "CentOS 7.9"];

function buildMachines(): Machine[] {
  const machines: Machine[] = [];
  datacenters.forEach((datacenter, dcIndex) => {
    for (let index = 1; index <= 9; index += 1) {
      const status: MachineStatus =
        index === 8 && dcIndex % 2 === 0
          ? "offline"
          : index === 4 || (index === 7 && dcIndex === 1)
            ? "warning"
            : "healthy";
      const subnet = 20 + dcIndex;
      machines.push({
        id: `${datacenter.id}-host-${String(index).padStart(2, "0")}`,
        ip: `10.${subnet}.${dcIndex + 1}.${10 + index}`,
        hostname: `cc-${["sh", "bj", "sz", "cd"][dcIndex]}-${[
          "trade",
          "web",
          "db",
          "cache",
          "monitor",
          "log",
        ][(index - 1) % roles.length]}-${String(index).padStart(2, "0")}`,
        datacenter_id: datacenter.id,
        datacenter_name: datacenter.name,
        rack: `${String.fromCharCode(65 + dcIndex)}${String(
          Math.ceil(index / 3),
        ).padStart(2, "0")}-${String(8 + index).padStart(2, "0")}`,
        role: roles[(index - 1) % roles.length],
        os: systems[(index + dcIndex) % systems.length],
        status,
        cpu_percent:
          status === "offline"
            ? 0
            : status === "warning"
              ? 86 + index
              : 18 + ((index * 9 + dcIndex * 7) % 52),
        memory_percent:
          status === "offline"
            ? 0
            : status === "warning"
              ? 78 + index
              : 31 + ((index * 7 + dcIndex * 5) % 43),
        last_heartbeat:
          status === "offline"
            ? "2026-07-16T01:20:00.000Z"
            : new Date(
                Date.parse("2026-07-16T03:00:00.000Z") -
                  (index + dcIndex) * 31_000,
              ).toISOString(),
      });
    }
  });
  return machines;
}

export const machines = buildMachines();

export type MachineFilter = {
  datacenterIds?: string[];
  status?: MachineStatus;
  keyword?: string;
  limit?: number;
};

export function filterMachines(filter: MachineFilter = {}): Machine[] {
  const keyword = filter.keyword?.trim().toLowerCase();
  const datacenterSet = new Set(filter.datacenterIds ?? []);
  return machines
    .filter(
      (machine) =>
        (!datacenterSet.size || datacenterSet.has(machine.datacenter_id)) &&
        (!filter.status || machine.status === filter.status) &&
        (!keyword ||
          machine.ip.includes(keyword) ||
          machine.hostname.toLowerCase().includes(keyword) ||
          machine.datacenter_name.toLowerCase().includes(keyword) ||
          machine.rack.toLowerCase().includes(keyword) ||
          machine.role.toLowerCase().includes(keyword)),
    )
    .slice(0, filter.limit ?? machines.length);
}

export function infrastructureSummary(datacenterIds: string[] = []) {
  const selected = filterMachines({ datacenterIds });
  return {
    datacenter_count: new Set(selected.map((item) => item.datacenter_id)).size,
    machine_count: selected.length,
    healthy_count: selected.filter((item) => item.status === "healthy").length,
    warning_count: selected.filter((item) => item.status === "warning").length,
    offline_count: selected.filter((item) => item.status === "offline").length,
    average_cpu_percent: selected.length
      ? Math.round(
          selected.reduce((sum, item) => sum + item.cpu_percent, 0) /
            selected.length,
        )
      : 0,
    average_memory_percent: selected.length
      ? Math.round(
          selected.reduce((sum, item) => sum + item.memory_percent, 0) /
            selected.length,
        )
      : 0,
  };
}

export function findMachine(ipOrHostname: string): Machine | undefined {
  const query = ipOrHostname.trim().toLowerCase();
  return machines.find(
    (machine) =>
      machine.ip === query || machine.hostname.toLowerCase() === query,
  );
}
