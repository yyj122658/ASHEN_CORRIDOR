# 23578 纹路美术样稿

生成方式：内置 imagegen；透明 PNG 原图，未后期裁切、缩放或涂改。文件：`rune-23578-v1.png`。本次只补充占格纹路的美术样稿，不修改游戏代码，不将其登记为已经适配全部形状的正式资产库。

九宫格按行编号，实际占格为 2、3、5、7、8：

```text
.XX
.X.
XX.
```

视觉：紫黑生命金属、旧金属镶边、琥珀色能量刻线。连续折线经过 3→2→5→8→7；中央菱形道印为视觉焦点。这个走线仅为样稿图案，不代表已经新增游戏技能效果或端口规则。

定位：查看真实不规则纹路的外观，替代此前只有构件收藏品图、没有纹片本身的展示缺口。

接入要求：逻辑使用离散 cells；生成图包含外边距、细小磨损及手绘偏差，不能整张拉满三乘三底盘后假定天然对齐。正式版需要按统一格距制作/裁切贴图并由准确占格蒙版控制边界；碰撞、端口和通断依然由代码控制。完整纹路系列及统一尺寸图集尚未制作。

## 本次生成提示词的核心约束

Transparent top-down pixel-art living-metal rune fragment. Exact five-cell silhouette in a 3x3 grid: rows .XX / .X. / XX.; occupied cells 2,3,5,7,8. Flat orthographic inlay, continuous material, empty cells transparent. Dark violet oxidized bronze, restrained aged-gold perimeter, angular occult incisions, amber luminous rune channel connecting cell centers 3→2→5→8→7 with a central rhombus seal at cell 5. No pipes, modern electronics, perspective, UI, text, numbers, visible grid or background. One isolated asset with clear outer margin.

已检查：图像可解码、RGBA 透明通道；按非透明边界划分九宫格，各格中心的透明/非透明状态与 23578 一致。尚未做像素级格距及游戏内缩略图验收。
