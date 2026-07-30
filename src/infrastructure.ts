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
  maintenance_vendor_id: string;
  maintenance_vendor_name: string;
  rack: string;
  role: string;
  os: string;
  status: MachineStatus;
  cpu_percent: number;
  memory_percent: number;
  last_heartbeat: string;
};

export type VendorContact = {
  id: string;
  name: string;
  title: string;
  mobile: string;
  email: string;
  service_region: string;
  availability: string;
};

export type MaintenanceVendor = {
  id: string;
  name: string;
  short_name: string;
  service_scope: string[];
  service_level: string;
  hotline: string;
  email: string;
  contacts: VendorContact[];
};

export const maintenanceVendors: MaintenanceVendor[] = [
  {
    id: "vendor-huawei",
    name: "华为技术服务有限公司",
    short_name: "华为服务",
    service_scope: ["核心交易服务器", "网络设备", "存储设备"],
    service_level: "核心系统 7×24 小时响应",
    hotline: "400-830-2118",
    email: "ccbank-support@example.com",
    contacts: [
      {
        id: "contact-huawei-01",
        name: "陈嘉树",
        title: "客户服务经理",
        mobile: "138 0000 2101",
        email: "jiashu.chen@example.com",
        service_region: "上海、北京",
        availability: "工作日 09:00–18:00",
      },
      {
        id: "contact-huawei-02",
        name: "赵安宁",
        title: "高级技术工程师",
        mobile: "138 0000 2102",
        email: "anning.zhao@example.com",
        service_region: "全国远程支持",
        availability: "7×24 应急响应",
      },
    ],
  },
  {
    id: "vendor-h3c",
    name: "新华三技术有限公司",
    short_name: "新华三服务",
    service_scope: ["网银应用服务器", "交换机", "灾备网络"],
    service_level: "严重故障 30 分钟内响应",
    hotline: "400-810-0504",
    email: "ccbank-h3c@example.com",
    contacts: [
      {
        id: "contact-h3c-01",
        name: "周明远",
        title: "区域维保经理",
        mobile: "138 0000 3101",
        email: "mingyuan.zhou@example.com",
        service_region: "深圳、成都",
        availability: "工作日 08:30–18:00",
      },
      {
        id: "contact-h3c-02",
        name: "许知行",
        title: "网络支持工程师",
        mobile: "138 0000 3102",
        email: "zhixing.xu@example.com",
        service_region: "全国远程支持",
        availability: "7×24 应急响应",
      },
    ],
  },
  {
    id: "vendor-inspur",
    name: "浪潮计算机科技有限公司",
    short_name: "浪潮服务",
    service_scope: ["数据库服务器", "缓存节点", "日志与监控节点"],
    service_level: "现场服务 4 小时内到达",
    hotline: "400-860-0011",
    email: "ccbank-inspur@example.com",
    contacts: [
      {
        id: "contact-inspur-01",
        name: "林若川",
        title: "交付与维保经理",
        mobile: "138 0000 4101",
        email: "ruochuan.lin@example.com",
        service_region: "上海、成都",
        availability: "工作日 09:00–18:00",
      },
      {
        id: "contact-inspur-02",
        name: "唐亦辰",
        title: "服务器技术专家",
        mobile: "138 0000 4102",
        email: "yichen.tang@example.com",
        service_region: "全国远程支持",
        availability: "7×24 应急响应",
      },
    ],
  },
];

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
const roleVendorIds = [
  "vendor-huawei",
  "vendor-h3c",
  "vendor-inspur",
  "vendor-inspur",
  "vendor-h3c",
  "vendor-inspur",
];

function buildMachines(): Machine[] {
  const machines: Machine[] = [];
  datacenters.forEach((datacenter, dcIndex) => {
    for (let index = 1; index <= 9; index += 1) {
      const roleIndex = (index - 1) % roles.length;
      const vendorId = roleVendorIds[roleIndex];
      const vendor = maintenanceVendors.find((item) => item.id === vendorId)!;
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
        maintenance_vendor_id: vendor.id,
        maintenance_vendor_name: vendor.short_name,
        rack: `${String.fromCharCode(65 + dcIndex)}${String(
          Math.ceil(index / 3),
        ).padStart(2, "0")}-${String(8 + index).padStart(2, "0")}`,
        role: roles[roleIndex],
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
          machine.maintenance_vendor_name.toLowerCase().includes(keyword) ||
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

export function findMaintenanceVendor(
  idOrName: string,
): MaintenanceVendor | undefined {
  const query = idOrName.trim().toLowerCase();
  return maintenanceVendors.find(
    (vendor) =>
      vendor.id.toLowerCase() === query ||
      vendor.name.toLowerCase() === query ||
      vendor.short_name.toLowerCase() === query,
  );
}
