# 买家秀工作流提示词 V1

## 目标

上传一张裤子平铺图或模特上身图，识别并锁定裤子的真实版型、颜色、面料、腰头、褶位、口袋、裤长和裤脚宽度；每次输出 5 张竖版、全身、少年感买家秀。机位和构图保持统一，人物、背景、上衣、姿势和光线可变化。

## 最高优先级：裤子商品锁定

- 输入图片是裤子唯一的商品真值，不参考输入图中的人物、上衣、鞋、背景或水印。
- 必须保留裤子的颜色、面料质感、腰线、前褶、裆位、裤腿宽度、裤长、裤脚和自然垂坠褶皱。
- 禁止把阔腿裤改成直筒裤、锥形裤、束脚裤或喇叭裤；禁止收窄裤腿或裤脚。
- 禁止新增口袋、腰带、印花、Logo、侧条、抽绳或其他原图没有的设计。
- 画面必须从头到鞋完整展示，裤子不可被长上衣、外套、道具或裁切遮挡。

## 自动判断裤型

先判断 `PANTS_FIT`，只能在以下两类中选择一种，严禁混合：

- `WIDE_LEG`（阔腿裤）：臀部以下宽松，腿围大，裤脚宽；生成时保持从大腿到裤脚的宽阔体量、重力垂坠和鞋面附近的自然堆叠，不得变窄。
- `STRAIGHT_LEG`（直筒裤）：从大腿到裤脚保持较窄且基本等宽的直线筒形；不得擅自放大腿围和裤脚，也不得生成阔腿或气球效果。

本次白裤判断：`WIDE_LEG`。特征为白色高腰、双前褶、超宽裤腿、宽裤脚、长裤脚覆盖鞋面并自然堆叠。

## 固定机位与构图

- 竖版 3:4，写实手机街拍。
- 低眼平机位或轻微低机位，约 50mm 等效焦段，避免广角变形。
- 全身从头到鞋完整入镜，人物居中或轻微偏心，裤子占画面视觉主体。
- 保留足够地面与自然阴影，服装比例真实，双腿清晰可辨。
- 成年东亚男性，20–24 岁，清爽自然、有少年感；不得生成未成年人。

## 通用提示词模板

```text
Use the uploaded trouser image as the sole product reference. First classify the trousers as PANTS_FIT = WIDE_LEG or STRAIGHT_LEG, then preserve that fit exactly. Keep the exact product color, fabric texture, waistband, front pleats, rise, pocket placement, leg width, hem width, length, drape and natural folds. Do not redesign, recolor, narrow, widen, taper or add details. Never convert wide-leg trousers into straight, tapered, jogger or flared trousers; never convert straight-leg trousers into wide-leg trousers.

Create one photorealistic Chinese social-commerce buyer-showcase fashion photo. Vertical 3:4 composition, full body from head to shoes, low eye-level camera, natural 50mm perspective, trousers are the main subject, enough floor and realistic shadow visible. Use a different adult East Asian male model aged 20–24 with a clean youthful look. Randomize face, hairstyle, top, shoes, pose, scene and lighting while keeping the same camera language and product truth. The top must be different from previous outputs and must not cover the waistband or trouser silhouette. Natural hands, correct anatomy, realistic fabric physics, authentic candid smartphone photography, no studio catalog stiffness.

Scene: {{SCENE}}
Top: {{TOP}}
Pose: {{POSE}}
Lighting and mood: {{LIGHTING}}

No text, no watermark, no logo, no brand marks, no collage, no duplicated limbs, no cropped feet, no hidden waistband, no altered trousers.
```

## 本次 5 套已生成场景

### 01 水泥巷道 / 炭灰短袖

- 场景：安静的极简水泥巷道，浅灰墙面与少量绿植。
- 上衣：炭灰色宽松短袖 T 恤。
- 姿势：边走边回头，一手轻放口袋，另一只手自然摆动。
- 光线：柔和阴天日光，清爽、克制、真实街拍。

### 02 校园外墙 / 天蓝衬衫

- 场景：现代校园建筑外的浅色砖墙与树荫。
- 上衣：天蓝色宽松牛津纺衬衫，袖口自然挽起，内搭白背心。
- 姿势：靠墙站立，一脚微向前，低头整理袖口。
- 光线：明亮午后散射光，干净少年感。

### 03 河畔步道 / 条纹针织 Polo

- 场景：城市河畔步道，金属栏杆、远处桥体和虚化水面。
- 上衣：奶油色与海军蓝细条纹针织 Polo。
- 姿势：侧身望向河面，一手扶栏杆，双腿自然错开。
- 光线：清晨柔和暖光，轻松生活感。

### 04 地下通道 / 橄榄绿夹克

- 场景：现代地下人行通道，灰色墙面与重复顶灯。
- 上衣：短款橄榄绿飞行夹克，内搭浅灰 T 恤，夹克长度不遮腰头。
- 姿势：向镜头方向慢走，一手拿耳机，另一手插袋。
- 光线：冷色顶灯与轻微电影感，但保持真实手机摄影。

### 05 夜间便利店 / 酒红连帽衫

- 场景：夜间便利店外，暖色玻璃窗与轻微城市霓虹虚化。
- 上衣：酒红色宽松连帽卫衣，衣摆略短，不遮挡裤型。
- 姿势：站在店门旁整理耳机线，身体微侧，双腿自然分开。
- 光线：暖冷混合夜景，真实手持街拍，无过度商业棚拍感。

## 预留的 3 个场景（组成未来 8 场景库）

1. 工业风落地窗室内 / 海军蓝卫衣 / 侧身整理腕表 / 柔和窗光。
2. 清晨公园停车区 / 浅蓝牛仔夹克 / 单手拎帆布袋向前走 / 薄雾晨光。
3. 日落屋顶 / 苔绿色针织开衫 / 倚矮墙回头 / 金色逆光。

## 本次确认图

- `output/buyer-showcase-v1/01-concrete-alley-charcoal-tee.png`
- `output/buyer-showcase-v1/02-campus-blue-overshirt.png`
- `output/buyer-showcase-v1/03-riverside-striped-polo.png`
- `output/buyer-showcase-v1/04-underpass-olive-bomber.png`
- `output/buyer-showcase-v1/05-convenience-store-burgundy-hoodie.png`
