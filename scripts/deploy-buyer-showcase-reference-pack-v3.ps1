param(
  [string]$BaseUrl = 'http://127.0.0.1:53268'
)

$ErrorActionPreference = 'Stop'

$baseUrl = $BaseUrl.TrimEnd('/')
$projectId = 'cdb47f3e-f92f-4e02-afe7-22c53ee6c655'
$profileId = 'e838d5f6-1dcb-45fd-a8b7-6a316b26558c'
$promptDocument = 'docs/BUYER_SHOWCASE_TWO_PROMPTS_V3.md'

$referenceDefinitions = @(
  [pscustomobject]@{ Number = '01'; Name = '普通住宅电梯口'; Source = 'D:\桌面\SnowShot_2026-08-11_10-50-42.png'; File = 'buyer-effect-01-elevator.png'; Width = 705; Height = 877; Aspect = '3:4' },
  [pscustomobject]@{ Number = '02'; Name = '卧室落地镜近景'; Source = 'D:\桌面\SnowShot_2026-08-11_10-50-55.png'; File = 'buyer-effect-02-bedroom-mirror.png'; Width = 759; Height = 1015; Aspect = '3:4' },
  [pscustomobject]@{ Number = '03'; Name = '凌乱宿舍全身照'; Source = 'D:\桌面\SnowShot_2026-08-11_10-51-09.png'; File = 'buyer-effect-03-dorm-room.png'; Width = 764; Height = 1018; Aspect = '3:4' },
  [pscustomobject]@{ Number = '04'; Name = '日系城市路口'; Source = 'D:\桌面\SnowShot_2026-08-11_10-51-37.png'; File = 'buyer-effect-04-city-crossing.png'; Width = 775; Height = 1033; Aspect = '3:4' },
  [pscustomobject]@{ Number = '05'; Name = '街边店铺墙面'; Source = 'D:\桌面\SnowShot_2026-08-11_10-51-45.png'; File = 'buyer-effect-05-store-wall.png'; Width = 775; Height = 1033; Aspect = '3:4' },
  [pscustomobject]@{ Number = '06'; Name = '雨天咖啡店门口'; Source = 'D:\桌面\SnowShot_2026-08-11_10-52-01.png'; File = 'buyer-effect-06-rainy-cafe.png'; Width = 775; Height = 1033; Aspect = '3:4' },
  [pscustomobject]@{ Number = '07'; Name = '街边镜面自拍'; Source = 'D:\桌面\SnowShot_2026-08-11_10-52-12.png'; File = 'buyer-effect-07-street-mirror.png'; Width = 573; Height = 1033; Aspect = '9:16' }
)

$approvalPrompt = @'
REFERENCE ORDER IS MANDATORY.

Image 1 is the sole product reference for the trousers. It may be a flat-lay product photo or a lower-body worn photo. Identify and preserve only the trousers as the product: exact silhouette, waist height, leg width, length, fabric weight, drape, seams, pockets, closures, hems, color, texture and all visible construction details. Do not copy the source person, source top, source shoes, source background, source text, watermark or UI.

Image 2 is the sole photography-effect reference. Recreate its camera height, camera distance, lens perspective, portrait orientation, crop, framing, subject scale, subject placement, surrounding spatial relationships, background structure, light direction, light softness, exposure, shadow direction, shadow density and ordinary phone-camera character. If the reference is a close lower-body crop, keep that close crop; if it is a full-body view, keep the full body and similar headroom and foot room. Do not copy the reference person, reference outfit, reference trousers, readable text, watermark or UI.

Create one believable everyday buyer-show photo of an ordinary East Asian young adult man, not a fashion model, with natural proportions, normal skin texture, a common hairstyle and an unposed expression. He is wearing the exact trousers from Image 1 with a simple, plausible casual top, ordinary shoes and minimal accessories appropriate to the location. Make the clothes interact naturally with the body and gravity. Use realistic wrinkles, contact shadows, ambient color cast, imperfect ordinary lighting and small phone-camera imperfections. The result must feel like a real person casually photographed for a buyer review, not a commercial campaign, studio shoot, influencer portrait or AI beauty image.

No glamour retouching, no idealized face, no dramatic cinematic lighting, no luxury architecture, no fantasy styling, no extra people, no duplicated limbs, no malformed hands, no changed trouser design, no visible brand invention, no text, no watermark, no screenshot UI.
'@

$variationPrompt = @'
Use the single approved image as the only visual source and create exactly ONE standalone buyer-show photograph in this request. The software will run five independent requests and assign a different pose direction to each request.

LOCK EVERYTHING except the pose: keep exactly the same person and identity, face, hairstyle, body proportions, trousers and every trouser detail, top, shoes, accessories, background, objects, camera position, camera height, camera distance, lens perspective, portrait orientation, crop, framing, subject scale, color response, exposure, light direction, shadow direction, shadow density, reflections and weather. Do not redesign, restyle, beautify, clean up or replace anything.

Change only the model's natural everyday pose according to the pose direction appended to this request. Across the five independent requests, clearly cover a relaxed front view, left-facing view, right-facing view, back or back-three-quarter view, and one natural walking or turning movement. Every action must be visibly different, loose, spontaneous and appropriate to the existing crop and location, with varied hands, body direction, weight distribution, gaze and leg movement. Avoid stiff posing, repeated hand positions and repeated body angles. If the approved image is cropped below the face, do not invent a wider frame or reveal more of the body. Preserve correct anatomy and natural cloth tension, folds, drape, contact shadows and shoe-to-ground contact.

Return one complete photograph only. Never create a collage, grid, contact sheet, diptych, triptych, split-screen, storyboard, poster, comparison layout or multiple panels. Across the five independent requests, the results must look like the same person photographed seconds apart in the same place by the same phone. No background change, no outfit change, no trouser change, no new props, no camera change, no crop change, no lighting change, no identity drift, no glamour retouching, no commercial campaign style, no text, no watermark, no UI.
'@

function New-Id {
  return [guid]::NewGuid().Guid
}

function Invoke-VelaJson {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][ValidateSet('Get', 'Post', 'Put')][string]$Method,
    [object]$Body
  )

  $parameters = @{ Uri = $Uri; Method = $Method }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json; charset=utf-8'
    $parameters.Body = $Body | ConvertTo-Json -Depth 100 -Compress
  }
  return Invoke-RestMethod @parameters
}

$project = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId" -Method Get
$existingMedia = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId/media" -Method Get
$referenceMedia = @{}

foreach ($reference in $referenceDefinitions) {
  $existing = $existingMedia | Where-Object { $_.source.fileName -eq $reference.File } | Select-Object -First 1
  if ($existing) {
    $referenceMedia[$reference.File] = $existing
    continue
  }
  if (-not (Test-Path -LiteralPath $reference.Source)) {
    throw "参考图片不存在：$($reference.Source)"
  }
  $bytes = [System.IO.File]::ReadAllBytes($reference.Source)
  $body = @{
    data = "data:image/png;base64,$([Convert]::ToBase64String($bytes))"
    fileName = $reference.File
  }
  $referenceMedia[$reference.File] = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId/media" -Method Post -Body $body
}

$nodes = [System.Collections.Generic.List[object]]::new()
$groups = [System.Collections.Generic.List[object]]::new()
$pantsInputId = New-Id

$nodes.Add([pscustomobject]@{
  id = $pantsInputId
  type = 'Image'
  kind = 'image-input'
  title = '上传裤子商品图｜平铺图或模特下半身图'
  x = -1800
  y = 2450
  prompt = '这里只读取裤子商品信息；不读取原人物、上衣、鞋子、姿势、背景、文字或水印。'
  status = 'idle'
  model = 'Upload'
  aspectRatio = 'Auto'
  resolution = 'Auto'
  parentIds = @()
  outputCount = 1
})

$branchNodeIds = [System.Collections.Generic.List[object]]::new()

for ($index = 0; $index -lt $referenceDefinitions.Count; $index += 1) {
  $reference = $referenceDefinitions[$index]
  $rowY = -350 + ($index * 820)
  $referenceId = New-Id
  $approvalId = New-Id
  $variationId = New-Id
  $groupId = New-Id
  $media = $referenceMedia[$reference.File]
  $mediaUrl = if ($media.url) { $media.url } else { "/api/vela/projects/$projectId/media/$($media.id)/file" }

  $nodes.Add([pscustomobject]@{
    id = $referenceId
    type = 'Image'
    kind = 'image-input'
    title = "效果 $($reference.Number)｜$($reference.Name)｜拍摄角度参考"
    x = -850
    y = $rowY
    prompt = '这张图只定义机位、距离、构图、裁切、背景关系、光线方向和阴影层次；不复制人物、穿搭、裤子、文字、水印或界面。'
    status = 'success'
    model = 'Photography Reference'
    aspectRatio = $reference.Aspect
    resolution = "$($reference.Width)×$($reference.Height)"
    resultAspectRatio = "$($reference.Width)/$($reference.Height)"
    resultUrl = $mediaUrl
    uploadProgress = 100
    uploadSource = 'canvas-drop'
    parentIds = @()
    outputCount = 1
    groupId = $groupId
  })

  $nodes.Add([pscustomobject]@{
    id = $approvalId
    type = 'Image'
    kind = 'gpt-image'
    title = "效果 $($reference.Number)｜$($reference.Name)｜先生成1张确认图"
    x = 0
    y = $rowY
    prompt = $approvalPrompt
    status = 'idle'
    model = 'GPT Image'
    imageModel = 'gpt-image-2'
    profileId = $profileId
    aspectRatio = $reference.Aspect
    resolution = '2K'
    stylePreset = 'photo'
    parentIds = @($pantsInputId, $referenceId)
    outputCount = 1
    groupId = $groupId
  })

  $nodes.Add([pscustomobject]@{
    id = $variationId
    type = 'Image'
    kind = 'gpt-image'
    title = "效果 $($reference.Number)｜$($reference.Name)｜确认后生成5个姿势"
    x = 900
    y = $rowY
    prompt = $variationPrompt
    status = 'idle'
    model = 'GPT Image'
    imageModel = 'gpt-image-2'
    profileId = $profileId
    aspectRatio = $reference.Aspect
    resolution = '2K'
    stylePreset = 'photo'
    parentIds = @($approvalId)
    outputCount = 5
    imageBatchMode = 'pose-variation'
    groupId = $groupId
  })

  $groups.Add([pscustomobject]@{
    id = $groupId
    nodeIds = @($referenceId, $approvalId, $variationId)
    label = "效果 $($reference.Number)｜$($reference.Name)｜参考图 → 首图 → 5姿势"
  })

  $branchNodeIds.Add([pscustomobject]@{
    Number = $reference.Number
    ReferenceNodeId = $referenceId
    ApprovalNodeId = $approvalId
    VariationNodeId = $variationId
  })
}

$settings = [ordered]@{}
foreach ($property in $project.settings.PSObject.Properties) {
  $settings[$property.Name] = $property.Value
}
$settings['buyerShowcaseVersion'] = 'reference-pack-v3'
$settings['workflowMode'] = 'reference-two-prompts'
$settings['pantsInputNodeId'] = $pantsInputId
$settings['branches'] = @($branchNodeIds)
$settings['referenceCount'] = 7
$settings['expectedReferenceCount'] = 8
$settings['missingReferenceCount'] = 1
$settings['approvalOutputs'] = 1
$settings['variationOutputs'] = 5
$settings['profileId'] = $profileId
$settings['profileName'] = 'YMAN 主账户'
$settings['imageModel'] = 'gpt-image-2'
$settings['promptDocument'] = $promptDocument
$settings['lightingAndShadowRequired'] = $true

$payload = [ordered]@{
  schemaVersion = $project.schemaVersion
  id = $project.id
  name = '买家秀'
  createdAt = $project.createdAt
  updatedAt = $project.updatedAt
  nodes = @($nodes)
  groups = @($groups)
  viewport = [ordered]@{ x = 620; y = 150; zoom = 0.15 }
  settings = $settings
}

$saved = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId" -Method Put -Body $payload
$mediaAfter = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId/media" -Method Get
$approvalNodes = @($saved.nodes | Where-Object { $_.kind -eq 'gpt-image' -and $_.outputCount -eq 1 })
$variationNodes = @($saved.nodes | Where-Object { $_.kind -eq 'gpt-image' -and $_.outputCount -eq 5 })
$referenceNodes = @($saved.nodes | Where-Object { $_.model -eq 'Photography Reference' })

[pscustomobject]@{
  ProjectId = $saved.id
  ProjectName = $saved.name
  Version = $saved.settings.buyerShowcaseVersion
  TotalNodes = $saved.nodes.Count
  Groups = $saved.groups.Count
  References = $referenceNodes.Count
  ApprovalNodes = $approvalNodes.Count
  VariationNodes = $variationNodes.Count
  YmanNodes = @($saved.nodes | Where-Object { $_.kind -eq 'gpt-image' -and $_.profileId -eq $profileId }).Count
  MediaCount = $mediaAfter.Count
  MissingReferenceCount = $saved.settings.missingReferenceCount
} | ConvertTo-Json -Depth 5
