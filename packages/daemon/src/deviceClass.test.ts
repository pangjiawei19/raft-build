import { describe, expect, it } from "vitest";

import { classifyLinuxDmi, classifyMacHardware, detectDeviceClass } from "./deviceClass";

const macJson = (machine_name: string, machine_model = "Mac14,3") =>
  JSON.stringify({ SPHardwareDataType: [{ machine_name, machine_model, serial_number: "SERIAL123" }] });

describe("classifyMacHardware", () => {
  it.each([
    ["MacBook Pro", "laptop"],
    ["MacBook Air", "laptop"],
    ["Mac mini", "mini"],
    ["Mac Studio", "studio"],
    ["iMac", "imac"],
    ["Mac Pro", "desktop"],
  ])("%s → %s", (name, expected) => {
    expect(classifyMacHardware(macJson(name))).toBe(expected);
  });

  it("macOS virtual machines are vm whatever their name says", () => {
    expect(classifyMacHardware(macJson("Apple Virtual Machine 1", "VirtualMac2,1"))).toBe("vm");
  });

  it("an unknown model name, missing fields or bad JSON are unknown", () => {
    expect(classifyMacHardware(macJson("Mac Something New"))).toBeUndefined();
    expect(classifyMacHardware(JSON.stringify({ SPHardwareDataType: [{}] }))).toBeUndefined();
    expect(classifyMacHardware("not json")).toBeUndefined();
  });
});

describe("classifyLinuxDmi", () => {
  it.each([
    ["9\n", "laptop"],
    ["10\n", "laptop"],
    ["31\n", "laptop"],
    ["3\n", "desktop"],
    ["35\n", "desktop"],
    ["23\n", "server"],
    ["17\n", "server"],
  ])("chassis %s → %s", (chassisType, expected) => {
    expect(classifyLinuxDmi({ chassisType, sysVendor: "LENOVO\n", productName: "21CB\n" })).toBe(expected);
  });

  it("a hypervisor vendor or /sys/hypervisor wins over the chassis type", () => {
    expect(classifyLinuxDmi({ chassisType: "1\n", sysVendor: "QEMU\n", productName: "Standard PC (Q35 + ICH9, 2009)\n" })).toBe("vm");
    expect(classifyLinuxDmi({ chassisType: "1\n", sysVendor: "Amazon EC2\n", productName: "m6i.large\n" })).toBe("vm");
    expect(classifyLinuxDmi({ chassisType: "3\n", sysVendor: "Microsoft Corporation\n", productName: "Virtual Machine\n" })).toBe("vm");
    expect(classifyLinuxDmi({ chassisType: "23\n", hypervisorType: "xen\n" })).toBe("vm");
  });

  it("other or unreadable chassis types are unknown", () => {
    expect(classifyLinuxDmi({ chassisType: "1\n" })).toBeUndefined();
    expect(classifyLinuxDmi({ chassisType: "2\n" })).toBeUndefined();
    expect(classifyLinuxDmi({})).toBeUndefined();
  });
});

describe("detectDeviceClass", () => {
  it("macOS reads system_profiler; a failed run is unknown", async () => {
    await expect(detectDeviceClass("darwin", { macHardware: async () => macJson("Mac mini") })).resolves.toBe("mini");
    await expect(detectDeviceClass("darwin", { macHardware: async () => undefined })).resolves.toBeUndefined();
    await expect(detectDeviceClass("darwin", { macHardware: async () => { throw new Error("spawn failed"); } })).resolves.toBeUndefined();
  });

  it("Linux reads DMI from sysfs; WSL is unknown", async () => {
    const files: Record<string, string> = {
      "/proc/sys/kernel/osrelease": "6.1.0-arm64\n",
      "/sys/class/dmi/id/chassis_type": "10\n",
      "/sys/class/dmi/id/sys_vendor": "Dell Inc.\n",
    };
    await expect(detectDeviceClass("linux", { readFile: (file) => files[file] })).resolves.toBe("laptop");
    files["/proc/sys/kernel/osrelease"] = "5.15.153.1-microsoft-standard-WSL2\n";
    await expect(detectDeviceClass("linux", { readFile: (file) => files[file] })).resolves.toBeUndefined();
  });

  it("Linux without DMI (e.g. a Raspberry Pi) is unknown", async () => {
    await expect(detectDeviceClass("linux", { readFile: () => undefined })).resolves.toBeUndefined();
  });

  it("Windows is unknown for now", async () => {
    await expect(detectDeviceClass("win32")).resolves.toBeUndefined();
  });
});
