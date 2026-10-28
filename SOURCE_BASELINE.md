# 来源基线

- 来源项目：`publish-hxd1c-neutral-section-pantograph-training-pages`
- 来源分支：`main`
- 来源提交：`aa27d4dd74c1`
- 建立日期：2026-10-19

本项目只复制驾驶台、线路、LKJ 图片和 Three.js 运行库等通用素材。业务配置、制动动力学、考评状态机、LKJ 运行时和页面入口均位于本项目内，不引用来源项目的运行代码，也不写入来源项目。

途中调速环境采用项目内独立的线路窗口和地形资源。轨道中心线来自原 `NEIYI` 线路的 `5635——本务.pat + NEIYI.tdb`；场景来自同线路27个世界块的完整导出。`neiyi-speed-regulation-terrain.json` 的10块高程全部由 Open Rails 从原 `.t` 与 `_y.raw` 文件解析，不含推算瓦片；发布后不需要访问任何兄弟项目。

- Web轨道中心线文件 SHA-256：`FDFDC3EF9E25CB0190A1E7795C189D9FE4D727CA87EE63CDC843920A11FA4236`。
- 原 `5635——本务.pat` SHA-256：`66EFED0F9B037EAFA247D266052C202C46AD1C9C9FD5F66E0784C66D0E0A2B38`。
- 原 `NEIYI.tdb` SHA-256：`3AA06D4F52300E74EB8D7E87D89DC189016B6EC9D236047C15FB293902D05457`。
- 27世界块场景文件 SHA-256：`FC5A1B6548F17A307B78AC58416BC05149FCF9A05485EDA9A1B44846EE7D59C5`，与途中瞭望、终到停车等项目中的同名基线完全一致。
- 本项目10块原生地形文件 SHA-256：`CBB3A2B3C40D6D21950B4004E8241C91A72A71EE17D7FC3DD39B72C0F7B6F4D6`。
