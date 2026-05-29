export const CHANGELOG = [
  {
    version: "1.0.5",
    date: "2026-05-23",
    changes: [
      "新增更新日志页面与版本更新提示横幅",
      "新增右键菜单，可从页面、链接或选中文本快速保存",
      "新增密码强度提示和可选主密码提示",
      "导入浏览器书签时新增重复项处理",
    ],
  },
  {
    version: "1.0.3",
    date: "2026-05-18",
    changes: ["性能与稳定性优化"],
  },
  {
    version: "1.0.2",
    date: "2026-05-17",
    changes: [
      "设置页重构为双栏网格布局",
      "新增关闭浏览器时自动锁定选项",
      "新增修改主密码功能",
    ],
  },
];

export function getLatestVersion() {
  return CHANGELOG[0]?.version ?? "";
}
