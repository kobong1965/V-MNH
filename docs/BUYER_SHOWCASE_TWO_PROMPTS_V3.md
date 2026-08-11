# 买家秀两段式通用提示词 V3

以下提示词不描述任何固定裤子款式。裤子的颜色、版型、面料、口袋、缝线、裤脚、褶皱和穿着垂坠只从输入商品图读取。

## 提示词 A：生成首张买家秀

```text
REFERENCE ORDER IS MANDATORY.

Image 1 is the sole product reference for the trousers. It may be a flat-lay product photo or a lower-body worn photo. Identify and preserve only the trousers as the product: exact silhouette, waist height, leg width, length, fabric weight, drape, seams, pockets, closures, hems, color, texture and all visible construction details. Do not copy the source person, source top, source shoes, source background, source text, watermark or UI.

Image 2 is the sole photography-effect reference. Recreate its camera height, camera distance, lens perspective, portrait orientation, crop, framing, subject scale, subject placement, surrounding spatial relationships, background structure, light direction, light softness, exposure, shadow direction, shadow density and ordinary phone-camera character. If the reference is a close lower-body crop, keep that close crop; if it is a full-body view, keep the full body and similar headroom and foot room. Do not copy the reference person, reference outfit, reference trousers, readable text, watermark or UI.

Create one believable everyday buyer-show photo of an ordinary East Asian young adult man, not a fashion model, with natural proportions, normal skin texture, a common hairstyle and an unposed expression. He is wearing the exact trousers from Image 1 with a simple, plausible casual top, ordinary shoes and minimal accessories appropriate to the location. Make the clothes interact naturally with the body and gravity. Use realistic wrinkles, contact shadows, ambient color cast, imperfect ordinary lighting and small phone-camera imperfections. The result must feel like a real person casually photographed for a buyer review, not a commercial campaign, studio shoot, influencer portrait or AI beauty image.

No glamour retouching, no idealized face, no dramatic cinematic lighting, no luxury architecture, no fantasy styling, no extra people, no duplicated limbs, no malformed hands, no changed trouser design, no visible brand invention, no text, no watermark, no screenshot UI.
```

## 提示词 B：从确认首图分裂 5 个姿势

```text
Use the single approved image as the only visual source and create exactly ONE standalone buyer-show photograph in this request. The software will run five independent requests and assign a different pose direction to each request.

LOCK EVERYTHING except the pose: keep exactly the same person and identity, face, hairstyle, body proportions, trousers and every trouser detail, top, shoes, accessories, background, objects, camera position, camera height, camera distance, lens perspective, portrait orientation, crop, framing, subject scale, color response, exposure, light direction, shadow direction, shadow density, reflections and weather. Do not redesign, restyle, beautify, clean up or replace anything.

Change only the model's natural everyday pose according to the pose direction appended to this request. Across the five independent requests, clearly cover a relaxed front view, left-facing view, right-facing view, back or back-three-quarter view, and one natural walking or turning movement. Every action must be visibly different, loose, spontaneous and appropriate to the existing crop and location, with varied hands, body direction, weight distribution, gaze and leg movement. Avoid stiff posing, repeated hand positions and repeated body angles. If the approved image is cropped below the face, do not invent a wider frame or reveal more of the body. Preserve correct anatomy and natural cloth tension, folds, drape, contact shadows and shoe-to-ground contact.

Return one complete photograph only. Never create a collage, grid, contact sheet, diptych, triptych, split-screen, storyboard, poster, comparison layout or multiple panels. Across the five independent requests, the results must look like the same person photographed seconds apart in the same place by the same phone. No background change, no outfit change, no trouser change, no new props, no camera change, no crop change, no lighting change, no identity drift, no glamour retouching, no commercial campaign style, no text, no watermark, no UI.
```

## 参考效果名称

1. 普通住宅电梯口
2. 卧室落地镜近景
3. 凌乱宿舍全身照
4. 日系城市路口
5. 街边店铺墙面
6. 雨天咖啡店门口
7. 街边镜面自拍
8. 待补参考图
