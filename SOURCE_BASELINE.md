# 来源基线

- 来源项目：`publish-hxd1c-neutral-section-pantograph-training-pages`
- 来源分支：`main`
- 来源提交：`aa27d4dd74c1`
- 建立日期：2026-10-19

本项目只复制驾驶台、线路、LKJ 图片和 Three.js 运行库等通用素材。业务配置、制动动力学、考评状态机、LKJ 运行时和页面入口均位于本项目内，不引用来源项目的运行代码，也不写入来源项目。

途中调速环境采用项目内独立的线路窗口和地形资源。`neiyi-speed-regulation-terrain.json` 含大山铺区段原生瓦片，以及依据本项目线路轨迹和既有场景高程锚点重建的前置区段瓦片；发布后不需要访问任何兄弟项目。
