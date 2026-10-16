# 中国普通高中课程知识地图

本目录以教育部《普通高中课程方案和语文等学科课程标准（2017年版2020年修订）》为国家层基线。

`catalog.json` 当前完成 K0 数据契约接入和 K1 学科级目录：记录官方压缩包摘要、20 个学科标准、课程层级和学科根节点。它没有宣称课程模块、原子知识点、关系或互动课件已经完整覆盖。

`subjects/mathematics.json` 保存数学模块骨架，`subjects/mathematics-required-functions.json` 保存必修预备知识与函数主题原子节点，`subjects/mathematics-required-geometry-data-modeling.json` 保存必修几何与代数、概率与统计、数学建模与探究原子节点，`subjects/mathematics-selective-required.json` 保存选择性必修四个主题的原子节点；`subjects/physics-required.json` 保存物理必修 1—3 的运动与相互作用、能量、曲线运动与万有引力、静电场、电路、电磁场与能源主题原子节点；`subjects/physics-selective-required.json` 保存物理选择性必修 1—3 的动量、振动与波、光学、电磁感应、传感器、热学、原子核与量子主题原子节点；`subjects/physics-required-experiments.json` 完整记录必修 12 项与选择性必修 9 项学生必做实验及其知识、测量和误差关系；`subjects/physics-electives.json` 保存课标列出的选修 1—3 参考模块。八个分片均已完成来源核对，但尚未完成学科专家审校或教材版本映射；课标允许学校另行开设的自设选修不在国家基线覆盖声明内。

校验：

```powershell
npm run knowledge-map:check
```

规则：

- 教材章节不充当稳定知识节点 ID；
- AI 产生的节点默认为 `draft`；
- `subjectChecked` 不能先于 `sourceChecked`；
- 存在断链、重复 ID、未知根字段或先修环时校验失败；
- 对应 Learning Cluster 通过来源和学科审校前，不得宣称课件覆盖该知识范围。
