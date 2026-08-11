# 买家秀 8 场景工作流 V1

## 工作流结构

```text
上传裤子平铺图或模特下半身图
        ├─ 场景01固定底图 ─→ YMAN 场景01（5张）
        ├─ 场景02固定底图 ─→ YMAN 场景02（5张）
        ├─ 场景03固定底图 ─→ YMAN 场景03（5张）
        ├─ 场景04固定底图 ─→ YMAN 场景04（5张）
        ├─ 场景05固定底图 ─→ YMAN 场景05（5张）
        ├─ 场景06固定底图 ─→ YMAN 场景06（5张）
        ├─ 场景07固定底图 ─→ YMAN 场景07（5张）
        └─ 场景08固定底图 ─→ YMAN 场景08（5张）
```

- 生图账户：`YMAN 主账户`
- 图片模型：`gpt-image-2`
- 输出比例：`3:4`
- 输出规格：`2K`
- 每个场景：`5张`
- 总任务：`40张`
- YMAN 并发：`2`，其余任务由任务中心排队。

## 为什么使用固定背景底图

只写背景关键词时，每次生成的墙面、门窗、纸箱、车辆和机位都会发生变化。工作流为每个场景保存一张无人底图，生图节点同时接收：

1. 图片1：用户上传的裤子商品图；
2. 图片2：不可修改的场景底图。

提示词要求模型只把人物和裤子放进图片2的空位，保持图片2的构图、机位、透视、物体位置和光线不变。模特不单独固定，以便人物、上衣和动作每次变化。

## 8个固定场景

1. 普通住宅电梯厅：白墙、不锈钢电梯、米色瓷砖、设备箱。
2. 老旧小区停车区：灰墙、防盗窗、外露管线、电动车、垃圾桶。
3. 小出租屋客厅：白墙、瓷砖、沙发、落地扇、晾衣架、充电线。
4. 社区快递店：旧瓷砖、纸箱、塑料凳、粗糙路面、模糊招牌。
5. 写字楼后勤走廊：旧白墙、荧光灯、消防门、清洁车。
6. 老式住宅楼梯间：水泥楼梯、电表箱、金属扶手、日光灯。
7. 社区折扣小超市：普通货架、纸箱、塑料篮、白瓷砖、荧光灯。
8. 小区地下车库：水泥柱、外露管道、停车线、电动车、冷白灯。

场景底图目录：`library/buyer-showcase-scenes-v1/`

## 所有节点共用的商品规则

```text
Image 1 is the sole product reference for the trousers. It may be a flat-lay image or a lower-body worn image. Extract only the trousers and ignore the source person, top, shoes, pose, background and watermark. First classify PANTS_FIT as WIDE_LEG or STRAIGHT_LEG, then preserve that fit exactly. Keep the exact color, fabric, waistband, front pleats, rise, pocket placement, thigh width, leg width, hem width, length, drape and natural folds. Do not redesign, recolor, narrow, widen or add details. Never mix wide-leg and straight-leg silhouettes.

Image 2 is the locked background plate. Preserve its exact 3:4 crop, camera position, lens perspective, wall and floor geometry, every object's position, lighting, exposure, colors, wear, dirt and clutter. Do not move, remove, add, clean, beautify or redesign anything in Image 2. Insert the customer model only into the existing empty standing area and create a physically correct contact shadow matching Image 2.

Create a genuinely amateur Chinese e-commerce buyer-review photo, not an advertisement, lookbook or influencer post. Use a relatable ordinary adult East Asian male aged 21-29 with average proportions, everyday facial features, common haircut, natural skin texture, no makeup and no beauty retouching. Avoid model casting and professional posing. Full body from head to shoes; the waistband and complete trouser silhouette remain visible.

Unedited mid-range smartphone JPEG, flat everyday light, slight sensor noise, minor white-balance and framing imperfection, realistic anatomy and fabric physics. No cinematic light, bokeh, HDR, glossy grading, studio light, luxury styling, skin smoothing, text, watermark, logo or collage.
```

## 每场景5个动作与上衣

### 场景01 电梯厅

1. 洗旧藏蓝短袖；拿手机自然站立，看向一侧。
2. 深灰薄针织长袖；一手插袋，身体重心偏一侧。
3. 浅蓝普通衬衫；抬头看电梯楼层显示。
4. 米白短袖；低头整理袖口或衣摆。
5. 灰绿色短袖；刚走出电梯的自然迈步。

### 场景02 老旧小区

1. 灰绿色短袖；被朋友叫住，回头看向侧面。
2. 褪色海军蓝短袖；双手自然垂下等待。
3. 浅灰薄卫衣；一手插袋，一脚向前。
4. 普通蓝格衬衫；低头查看手机。
5. 米色短袖；缓慢走过停车线。

### 场景03 出租屋

1. 灰色长袖；低头查看裤子垂坠。
2. 洗旧黑色短袖；正面普通站姿。
3. 浅蓝家居短袖；侧身观察裤腿。
4. 米白薄卫衣；整理衣摆露出腰头。
5. 灰绿色短袖；在墙前缓慢走一步。

### 场景04 快递店

1. 浅蓝格纹衬衫加白短袖；低头看取件信息。
2. 洗旧灰短袖；站在门口等待。
3. 海军蓝普通Polo；转头看向店内。
4. 米色短袖；一手插袋，另一手拿手机。
5. 淡绿色短袖；自然迈下路沿。

### 场景05 后勤走廊

1. 米色卫衣；靠墙等候并看向一侧。
2. 深灰短袖；双手自然垂下。
3. 浅蓝衬衫；低头整理袖口。
4. 灰绿色长袖；回头看消防门。
5. 洗旧藏蓝短袖；朝镜头方向走一步。

### 场景06 楼梯间

1. 浅灰短袖；一手轻扶栏杆。
2. 洗旧蓝色长袖；站在平台看向楼梯。
3. 米白短袖；双手插袋普通站姿。
4. 淡绿色衬衫；从第一节台阶缓慢走下。
5. 深灰短袖；低头整理腰头和衣摆。

### 场景07 小超市

1. 灰绿色短袖；提蓝色购物篮停在身侧。
2. 藏蓝短袖；转头查看右侧货架。
3. 浅灰卫衣；手拿一件普通商品查看。
4. 米白短袖；推开步伐从过道走来。
5. 浅蓝衬衫；一手插袋，在货架前等待。

### 场景08 地下车库

1. 洗旧黑色短袖；朝镜头缓慢走来。
2. 灰绿色短袖；侧身看向停车位。
3. 米色薄卫衣；低头查看手机。
4. 浅蓝衬衫；双手插袋普通站立。
5. 深灰短袖；走过后自然回头。
