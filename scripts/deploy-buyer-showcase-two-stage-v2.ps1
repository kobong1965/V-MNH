param(
  [string]$BaseUrl = 'http://127.0.0.1:53268'
)

$ErrorActionPreference = 'Stop'

$baseUrl = $BaseUrl.TrimEnd('/')
$projectId = 'cdb47f3e-f92f-4e02-afe7-22c53ee6c655'
$profileId = 'e838d5f6-1dcb-45fd-a8b7-6a316b26558c'
$backgroundFileName = '01-elevator-hallway.png'
$promptDocument = 'vela/docs/BUYER_SHOWCASE_SINGLE_SCENE_TWO_STAGE_V2.md'

function New-Id {
  return [guid]::NewGuid().Guid
}

function Invoke-VelaJson {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][ValidateSet('Get', 'Put')][string]$Method,
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
$media = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId/media" -Method Get
$backgroundMedia = $media | Where-Object { $_.source.fileName -eq $backgroundFileName } | Select-Object -First 1
if (-not $backgroundMedia) {
  throw "项目中找不到固定背景底图：$backgroundFileName"
}
$backgroundUrl = "/api/vela/projects/$projectId/media/$($backgroundMedia.id)/file"

$guideId = New-Id
$pantsInputId = New-Id
$backgroundId = New-Id
$approvalId = New-Id
$variationId = New-Id

$approvalPrompt = @'
REFERENCE ORDER IS MANDATORY.

Image 1 is the sole product reference for the trousers. It may be a flat-lay image or a lower-body worn image. Extract only the trousers and ignore the original person, top, shoes, pose, background, text and watermark. First classify the trousers as WIDE_LEG or STRAIGHT_LEG and preserve that fit exactly. Preserve the exact color, fabric, waistband, pleats, rise, pocket placement, thigh width, leg width, hem width, length, drape and natural folds. Never redesign, recolor, narrow, widen or mix wide-leg and straight-leg fits.

Image 2 is the locked background plate. Preserve its exact 3:4 crop, camera position, lens perspective, walls, floor, elevator, fixtures, dirt, wear and every object's position. Do not clean, beautify, move, remove or add background objects.

Generate ONE approval image only. Insert one ordinary adult East Asian male age 21-29 with average proportions, common haircut, everyday facial features, natural skin texture and a reserved expression. Avoid handsome model styling, influencer styling, makeup and retouching. Use a plain washed navy crew-neck T-shirt, ordinary dark casual shoes and no visible brand logo. Show the complete body from head to shoes, with the waistband and full trousers clearly visible. Use a natural standing pose with one arm relaxed and the other holding a phone at the side.

LIGHT AND SHADOW ARE REQUIRED. Treat Image 2 as the only lighting truth. Match the exact key-light direction, light height, intensity, softness, color temperature, ambient fill, exposure and local contrast of the background. Add physically consistent light on the face, shirt and trousers. Add a subtle foot contact shadow and cast shadow whose direction, edge softness and density match the background. Match existing wall and floor bounce light and any metal reflection from the elevator. The person must look genuinely present in the scene, never pasted in.

Create an unedited mid-range smartphone buyer-review photo: ordinary flat exposure, slight sensor noise, minor white-balance and framing imperfections. No cinematic light, bokeh, HDR, studio light, luxury styling, fashion editorial look, text or watermark.
'@

$variationPrompt = @'
The input image is the APPROVED MASTER IMAGE. Generate five buyer-review photo variations from this master.

IDENTITY AND PRODUCT LOCK: preserve the exact same person, face, facial features, hairstyle, body proportions, skin tone and apparent age. Preserve the exact same trousers including fit, color, fabric, waistband, pleats, pockets, width, length, drape and folds. Preserve the exact same T-shirt, shoes, phone, accessories and all styling. Do not redesign or replace anything.

BACKGROUND AND CAMERA LOCK: preserve the exact same background, elevator, walls, floor, fixtures, dirt, wear, object positions, 3:4 crop, camera height, lens perspective, framing and subject scale. Do not move, remove, add, clean, beautify or regenerate background details.

LIGHT AND SHADOW LOCK: preserve the exact same light source direction, height, intensity, softness, color temperature, ambient fill, exposure, local contrast, wall and floor bounce light, metal reflections, facial shading, clothing shading, foot contact shadow and cast-shadow direction. The five outputs must look like photos taken seconds apart without any lighting change.

ONLY CHANGE THE BODY ACTION. Across the five outputs, cover these five different natural actions with no repeat:
1. One hand naturally in the trouser pocket, body weight slightly shifted.
2. Looking down at the trouser drape, feet naturally apart.
3. Turning the body about 30 degrees and looking outside the frame.
4. Looking down at the phone while the other arm hangs naturally.
5. Taking one slow step forward in a casual walking moment.

Keep ordinary slightly reserved buyer behavior. No fashion-model pose, no dramatic gesture, no new person, no new outfit, no new background and no new lighting setup.
'@

$nodes = @(
  [pscustomobject]@{
    id = $guideId
    type = 'Text'
    kind = 'prompt'
    title = '买家秀｜单场景两阶段使用说明'
    x = -1650
    y = -620
    prompt = "① 上传一张裤子平铺图或模特下半身图。`n② 点击【先生成1张确认图】。`n③ 确认人物、裤型、穿搭、背景和光影都正确。`n④ 再点击【确认后生成5张】，只改变动作。`n⑤ 当前一次只添加一个场景；需要新场景时再单独建立下一条连线。`n`n关键词：$promptDocument"
    status = 'idle'
    model = 'Workflow Guide'
    aspectRatio = 'Auto'
    resolution = 'Auto'
    parentIds = @()
    outputCount = 1
    textMode = 'editing'
  },
  [pscustomobject]@{
    id = $pantsInputId
    type = 'Image'
    kind = 'image-input'
    title = '① 上传裤子商品图'
    x = -1650
    y = 260
    prompt = '支持裤子平铺图或模特下半身图；这里只读取裤子商品信息。'
    status = 'idle'
    model = 'Upload'
    aspectRatio = 'Auto'
    resolution = 'Auto'
    parentIds = @()
    outputCount = 1
  },
  [pscustomobject]@{
    id = $backgroundId
    type = 'Image'
    kind = 'image-input'
    title = '固定场景｜普通住宅电梯厅（勿替换）'
    x = -850
    y = 260
    prompt = '锁定背景、机位、环境物件、光线方向、色温、曝光和阴影。'
    status = 'success'
    model = 'Fixed Scene'
    aspectRatio = '3:4'
    resolution = '1086×1448'
    resultAspectRatio = '3/4'
    resultUrl = $backgroundUrl
    uploadProgress = 100
    uploadSource = 'canvas-drop'
    parentIds = @()
    outputCount = 1
  },
  [pscustomobject]@{
    id = $approvalId
    type = 'Image'
    kind = 'gpt-image'
    title = '② 先生成1张确认图｜人物＋裤型＋穿搭＋光影'
    x = 0
    y = 260
    prompt = $approvalPrompt
    status = 'idle'
    model = 'GPT Image'
    imageModel = 'gpt-image-2'
    profileId = $profileId
    aspectRatio = '3:4'
    resolution = '2K'
    stylePreset = 'photo'
    parentIds = @($pantsInputId, $backgroundId)
    outputCount = 1
  },
  [pscustomobject]@{
    id = $variationId
    type = 'Image'
    kind = 'gpt-image'
    title = '③ 确认后生成5张｜同人同景同穿搭同光影'
    x = 900
    y = 260
    prompt = $variationPrompt
    status = 'idle'
    model = 'GPT Image'
    imageModel = 'gpt-image-2'
    profileId = $profileId
    aspectRatio = '3:4'
    resolution = '2K'
    stylePreset = 'photo'
    parentIds = @($approvalId)
    outputCount = 5
  }
)

$settings = [ordered]@{}
foreach ($property in $project.settings.PSObject.Properties) {
  $settings[$property.Name] = $property.Value
}
$settings['buyerShowcaseVersion'] = 'two-stage-v2'
$settings['workflowMode'] = 'single-scene-two-stage'
$settings['pantsInputNodeId'] = $pantsInputId
$settings['backgroundNodeId'] = $backgroundId
$settings['approvalNodeId'] = $approvalId
$settings['variationNodeId'] = $variationId
$settings['approvalOutputs'] = 1
$settings['variationOutputs'] = 5
$settings['sceneCount'] = 1
$settings['profileId'] = $profileId
$settings['profileName'] = 'YMAN 主账户'
$settings['imageModel'] = 'gpt-image-2'
$settings['promptDocument'] = $promptDocument
$settings['lightShadowLock'] = $true

$payload = [ordered]@{
  schemaVersion = $project.schemaVersion
  id = $project.id
  name = $project.name
  createdAt = $project.createdAt
  updatedAt = $project.updatedAt
  nodes = $nodes
  groups = @()
  viewport = [ordered]@{ x = 650; y = 260; zoom = 0.32 }
  settings = $settings
}

$saved = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId" -Method Put -Body $payload
$generators = @($saved.nodes | Where-Object { $_.kind -eq 'gpt-image' })

[pscustomobject]@{
  Project = $saved.name
  Version = $saved.settings.buyerShowcaseVersion
  Nodes = $saved.nodes.Count
  Groups = $saved.groups.Count
  ApprovalOutputs = ($generators | Where-Object { $_.id -eq $approvalId }).outputCount
  VariationOutputs = ($generators | Where-Object { $_.id -eq $variationId }).outputCount
  YmanNodes = @($generators | Where-Object { $_.profileId -eq $profileId }).Count
  ApprovalParents = @($generators | Where-Object { $_.id -eq $approvalId }).parentIds.Count
  VariationParents = @($generators | Where-Object { $_.id -eq $variationId }).parentIds.Count
  LightShadowLock = $saved.settings.lightShadowLock
} | ConvertTo-Json -Depth 5
