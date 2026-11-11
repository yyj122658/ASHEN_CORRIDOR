# 给 coding agent：老兵回路版开工入口

用户已选“培养老兵并保护撤离”的方向，认可同一遭遇不限次重新整备、固定敌人/RNG、确认结果后才落账、紧急败退损失本局收获的规则。

## 阅读顺序

1. [设计基线](superpowers/specs/2026-11-11-veteran-circuit-design.md)
2. [12步实施计划](superpowers/plans/2026-11-11-veteran-circuit-implementation.md)
3. [美术与并行协议](art/2026-11-11-veteran-art-contract.md)
4. [已交付八图接入说明](../assets/art/veteran-v1/INTEGRATION.md)

按上述计划直接实现，不再沿用旧B计划作为新机制需求。新入口veteran.html、新命名空间Ashen.Veteran、新存档key，保留旧index和v2存档。先做状态、回路、战斗与确认/回转事务，再接探索/养成/UI与美术。所有步骤都要实际执行测试并报告未完成项。

首版不加永久死格、随机失控排异、永久扣生命的烙印或角色永久死亡；营地装配可逆；只有战斗回转不能倒回地图换节点。

关键审查点：分流能量守恒；所有底盘都有可用线路；短刃能靠普攻触发前移；同一行动换位有界；战斗奖励唯一确认；烙印不能把本局构件洗成安全资产；正常撤离临时绑定固化且战史调谐只提交一次；旧版和两套存档隔离。

已交付美术位于assets/art/veteran-v1，共8张；旧18图和两角色48帧动画继续复用。美术agent不并行修改运行时代码，coding agent负责所有HTML/CSS/SVG/Canvas与接入。格子、端口和路径必须代码绘制，构件物件插画不作为碰撞数据。
