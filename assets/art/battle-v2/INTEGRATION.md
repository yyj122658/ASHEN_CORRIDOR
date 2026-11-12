# 骨犬素材

- `hound.png`：内置 imagegen 生成并通过第二次编辑去除背景，1254×1254 RGBA，背景 alpha=0。
- 以 `manifest.json` 的 bounds 作为实际主体采样区域，在 Canvas 中保持宽高比绘制，脚底与战场 ground 对齐。
- 逻辑尺寸宽48，主体高约19.6；倒地压低并降低透明度。沿用现有攻击位移、受击反馈与暂停逻辑，不声称此资源具有逐帧动画。
- `Art.preloadFor('battle')` 按需加载；失败时回退现有骨犬像素绘制。
- 所有传奇复用 battle-v1 精细人形逐帧动画，以低饱和色调区分外观；首领复用骸骨动画并放大，噬忆者有不同色调。打法只来自功法，不从这些外观推导。

## 生成提示词

内置 imagegen，风格参考 `assets/art/battle-v1/bone/frames/idle/01.png`。

Create a single full body skeletal hound, side profile facing LEFT, aggressive stalking crouch, all four feet visible, body horizontal, mouth slightly open, believable dog skull and ribcage, long bony tail, weathered dark iron and leather around spine, tiny ember orange eye and rib glow. Match the reference's meticulous dark fantasy pixel art: deliberate pixel clusters, weathered ivory bones, rusty umber iron, bronze highlights, readable dark outline. One creature only; whole body inside the canvas; no environment, text, UI or cast shadow; transparent alpha background.

透明编辑提示词：Remove ONLY the flat solid black background and replace it with real transparent RGBA alpha. Keep the entire hound's pose, shape, armor, ribcage, eye glow, colors and proportions. Preserve fine bone tips, tail, paws, teeth, and natural dark crevices inside the creature. No checkerboard painted into the image, no shadow, no additions.
