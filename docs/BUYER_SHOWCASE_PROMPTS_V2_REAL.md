# 买家秀工作流提示词 V2（真实手机随拍版）

## 本版修改方向

- 不做服装广告、时尚大片、网红街拍或影棚目录图。
- 人物使用普通成年消费者形象：平均身材、普通脸型和发型、真实皮肤纹理、轻微瑕疵、无妆、无磨皮、姿态略拘谨。
- 背景使用电梯厅、旧小区、出租屋、快递店、后勤走廊等日常空间；允许旧墙、杂物、纸箱、清洁车和普通照明入镜。
- 模拟朋友使用普通中端手机随手拍：轻微构图偏差、白平衡不完美、动态范围有限、少量噪点、平光、无电影调色。

## 裤型锁定规则

输入图只用于提取裤子。先判断 `PANTS_FIT=WIDE_LEG` 或 `PANTS_FIT=STRAIGHT_LEG`，然后严格保留商品的颜色、面料、腰头、前褶、裆位、腿围、裤脚宽度、裤长和自然垂坠。

本次为 `WIDE_LEG`：白色高腰、双前褶、臀腿宽松、裤腿从大腿到裤脚一直很宽、裤长覆盖鞋面并自然堆叠。严禁改成直筒、锥形、束脚、喇叭、气球或修身裤。

## 可复用通用提示词

```text
Use the uploaded images only as the sole product reference for the trousers. First classify PANTS_FIT as WIDE_LEG or STRAIGHT_LEG, then preserve that fit exactly. Keep the exact color, fabric, waistband, front pleats, rise, pocket placement, thigh width, leg width, hem width, length, drape and natural folds. Do not redesign, recolor, narrow, widen or add details. Never mix wide-leg and straight-leg silhouettes.

Create a genuinely amateur Chinese e-commerce buyer-review snapshot, not an advertisement, not a lookbook and not influencer content. Vertical 3:4, normal mid-range phone 1x camera held by a friend at chest-to-waist height, full body from head to shoes, mostly centered with slightly imperfect spacing, enough ordinary floor visible. The trousers remain the main subject and the waistband and full silhouette stay visible.

Use a relatable ordinary adult East Asian male customer aged 21-29 with average proportions, an everyday face, common unstyled haircut, natural pores, minor blemishes, faint under-eye circles, no makeup and no beauty retouching. Avoid celebrity casting, model jawlines, influencer styling and professional poses. Use an ordinary inexpensive top that does not cover the waistband.

Scene: {{MUNDANE_SCENE}}
Top: {{ORDINARY_TOP}}
Pose: {{CASUAL_IMPERFECT_POSE}}

Unedited phone JPEG look, flat everyday lighting, slight sensor grain, minor white-balance error, modest dynamic range, small framing imperfection, natural fabric wrinkles and realistic anatomy. No cinematic lighting, golden-hour glow, dramatic shadows, bokeh, HDR, glossy grading, studio light, luxury location, perfectly clean set, skin smoothing, fashion-magazine polish, text, watermark, logo or collage.
```

## 本次5个场景变量

1. 普通住宅电梯厅；旧墙、瓷砖、不锈钢电梯；洗旧藏蓝短袖；刚出电梯，拿手机自然站立。
2. 老旧小区停车区；灰墙、电动车、垃圾桶、褪色地面线；灰绿色短袖；被朋友叫住时向侧面看。
3. 小出租屋客厅；瓷砖、沙发、落地扇、晾衣架和充电线；灰色长袖；低头看裤子上身效果。
4. 社区快递店门口；旧瓷砖、纸箱、塑料凳、粗糙路面；浅蓝格纹衬衫；普通圆脸眼镜男低头看取件信息。
5. 写字楼后勤走廊；旧白墙、荧光灯、消防门、清洁车；米色卫衣；普通短发眼镜男靠墙等候并看向一侧。

## 输出文件

- `output/buyer-showcase-v2-real/01-elevator-hallway-navy-tee.png`
- `output/buyer-showcase-v2-real/02-old-community-sage-tee.png`
- `output/buyer-showcase-v2-real/03-rental-room-gray-top.png`
- `output/buyer-showcase-v2-real/04-courier-shop-blue-shirt.png`
- `output/buyer-showcase-v2-real/05-service-corridor-beige-sweatshirt.png`
