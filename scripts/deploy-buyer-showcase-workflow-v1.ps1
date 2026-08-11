$ErrorActionPreference = 'Stop'

$baseUrl = 'http://127.0.0.1:53268'
$projectId = 'cdb47f3e-f92f-4e02-afe7-22c53ee6c655'
$profileId = 'e838d5f6-1dcb-45fd-a8b7-6a316b26558c'
$sceneDirectory = 'D:\codex项目\minimaxAi视频前端\vela\library\buyer-showcase-scenes-v1'
$promptDocument = 'vela/docs/BUYER_SHOWCASE_8_SCENE_WORKFLOW_V1.md'

function New-Id {
  return [guid]::NewGuid().Guid
}

function Invoke-VelaJson {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][ValidateSet('Get', 'Post', 'Put')][string]$Method,
    [object]$Body
  )

  $parameters = @{
    Uri = $Uri
    Method = $Method
  }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json; charset=utf-8'
    $parameters.Body = $Body | ConvertTo-Json -Depth 100 -Compress
  }
  return Invoke-RestMethod @parameters
}

$sceneDefinitions = @(
  [pscustomobject]@{
    Number = '01'; Name = '普通住宅电梯厅'; File = '01-elevator-hallway.png'
    Variants = @(
      'washed navy crew-neck T-shirt; phone hanging naturally at the side; looking away from camera',
      'dark gray thin knit long-sleeve top; one hand in trouser pocket; weight shifted casually',
      'ordinary pale blue shirt; glancing up at the elevator display',
      'off-white T-shirt; adjusting one cuff or hem while looking down',
      'faded sage T-shirt; taking one natural step out of the elevator'
    )
  },
  [pscustomobject]@{
    Number = '02'; Name = '老旧小区停车区'; File = '02-old-community-parking.png'
    Variants = @(
      'sage T-shirt; turning toward a friend who just called him',
      'faded navy T-shirt; both arms relaxed while waiting',
      'light gray thin sweatshirt; one hand in pocket and one foot slightly forward',
      'ordinary blue-check shirt; looking down at a phone',
      'beige T-shirt; walking slowly across the existing parking line'
    )
  },
  [pscustomobject]@{
    Number = '03'; Name = '小出租屋客厅'; File = '03-rental-living-room.png'
    Variants = @(
      'gray long-sleeve home top; looking down at the trouser drape',
      'washed black T-shirt; ordinary front-facing stance',
      'pale blue home T-shirt; slight side turn to inspect the trouser leg',
      'off-white thin sweatshirt; adjusting the hem to show the waistband',
      'sage T-shirt; taking one slow step beside the wall'
    )
  },
  [pscustomobject]@{
    Number = '04'; Name = '社区快递店'; File = '04-courier-shop.png'
    Variants = @(
      'pale blue check overshirt over a plain white T-shirt; checking pickup information on phone',
      'washed gray T-shirt; standing at the doorway waiting',
      'ordinary navy polo; turning toward the shop interior',
      'beige T-shirt; one hand in pocket and the other holding a phone',
      'pale green T-shirt; taking a natural step off the existing curb'
    )
  },
  [pscustomobject]@{
    Number = '05'; Name = '后勤走廊'; File = '05-service-corridor.png'
    Variants = @(
      'beige sweatshirt; lightly leaning against the wall and looking to one side',
      'dark gray T-shirt; both hands hanging naturally',
      'pale blue shirt; looking down while adjusting one cuff',
      'sage long-sleeve top; looking back toward the fire door',
      'washed navy T-shirt; taking one step toward the camera'
    )
  },
  [pscustomobject]@{
    Number = '06'; Name = '老旧楼梯间'; File = '06-old-stairwell.png'
    Variants = @(
      'light gray T-shirt; one hand lightly touching the handrail',
      'washed blue long-sleeve top; standing on the landing and looking upstairs',
      'off-white T-shirt; ordinary stance with both hands in pockets',
      'pale green shirt; slowly descending the first stair',
      'dark gray T-shirt; looking down while adjusting the waistband and top hem'
    )
  },
  [pscustomobject]@{
    Number = '07'; Name = '折扣小超市'; File = '07-discount-supermarket.png'
    Variants = @(
      'sage T-shirt; holding the existing blue shopping basket at the side',
      'navy T-shirt; turning to inspect the shelf on the right',
      'light gray sweatshirt; holding and inspecting one ordinary product',
      'off-white T-shirt; walking naturally down the aisle',
      'pale blue shirt; one hand in pocket while waiting near the shelf'
    )
  },
  [pscustomobject]@{
    Number = '08'; Name = '地下停车库'; File = '08-underground-garage.png'
    Variants = @(
      'washed black T-shirt; walking slowly toward the camera',
      'sage T-shirt; side stance looking toward the parking bay',
      'beige thin sweatshirt; looking down at a phone',
      'pale blue shirt; ordinary standing pose with both hands in pockets',
      'dark gray T-shirt; naturally looking back after walking past'
    )
  }
)

$commonPrompt = @'
REFERENCE ORDER IS MANDATORY:
Image 1 is the sole product reference for the trousers. It may be a flat-lay product image or a lower-body worn image. Extract only the trousers. Ignore and never copy the source person, top, shoes, pose, background, text or watermark. First classify PANTS_FIT as WIDE_LEG or STRAIGHT_LEG, then preserve that fit exactly. Preserve the exact product color, fabric, waistband, front pleats, rise, pocket placement, thigh width, leg width, hem width, length, drape and natural folds. Never redesign, recolor, narrow, widen, add details or mix wide-leg and straight-leg fits.

Image 2 is the LOCKED BACKGROUND PLATE. Preserve its exact 3:4 crop, camera position, lens perspective, wall and floor geometry, every object's position, lighting, exposure, colors, wear, dirt and clutter. Do not move, remove, add, clean, beautify or redesign anything in Image 2. Insert one customer only into the existing empty standing area and create a subtle contact shadow matching Image 2.

Create a genuinely amateur Chinese e-commerce buyer-review photo, never an advertisement, fashion lookbook or influencer post. Use one ordinary adult East Asian male age 21-29 with average proportions, everyday facial features, a common haircut, natural skin texture and a slightly reserved expression. He must not be handsome-model styled. No makeup, retouching or exaggerated pose. Show full body from head to shoes; waistband and the complete trousers must remain clearly visible and be the visual priority. Use an unedited mid-range smartphone JPEG look, ordinary flat light, slight sensor noise, small white-balance and framing imperfections. No cinematic light, bokeh, HDR, studio light, luxury styling, text, watermark or logo.

For this five-image scene set, use a different numbered wardrobe-and-action variant for each output, covering variants 1 through 5 with no repeat. Do not change the locked background between variants.
'@

$project = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId" -Method Get
$existingMedia = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId/media" -Method Get
$sceneMedia = @{}

foreach ($scene in $sceneDefinitions) {
  $existing = $existingMedia | Where-Object { $_.source.fileName -eq $scene.File } | Select-Object -First 1
  if ($existing) {
    $sceneMedia[$scene.File] = $existing
    continue
  }

  $filePath = Join-Path $sceneDirectory $scene.File
  if (-not (Test-Path -LiteralPath $filePath)) {
    throw "固定场景底图不存在：$filePath"
  }
  $bytes = [System.IO.File]::ReadAllBytes($filePath)
  $body = @{
    data = "data:image/png;base64,$([Convert]::ToBase64String($bytes))"
    fileName = $scene.File
  }
  $sceneMedia[$scene.File] = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId/media" -Method Post -Body $body
}

$nodes = [System.Collections.Generic.List[object]]::new()
$groups = [System.Collections.Generic.List[object]]::new()

$instructionId = New-Id
$pantsInputId = New-Id

$nodes.Add([pscustomobject]@{
  id = $instructionId
  type = 'Text'
  kind = 'prompt'
  title = '买家秀 8 场景｜使用说明'
  x = -2500
  y = 600
  prompt = "① 点击下方上传节点，放入一张裤子平铺图或模特下半身图。`n② 确认裤型（阔腿或直筒）清晰可见。`n③ 分别点击 8 个 YMAN 场景节点的生成箭头；每个场景生成 5 张，共 40 张。`n④ 8 张背景是锁定场景底图；人物、上衣和动作变化，背景不变化。`n⑤ YMAN 主账户并发上限 2，其余任务会自动排队。`n`n关键词文档：$promptDocument"
  status = 'idle'
  model = 'Workflow Guide'
  aspectRatio = 'Auto'
  resolution = 'Auto'
  parentIds = @()
  outputCount = 1
  textMode = 'editing'
})

$nodes.Add([pscustomobject]@{
  id = $pantsInputId
  type = 'Image'
  kind = 'image-input'
  title = '① 上传裤子平铺图或模特下半身图'
  x = -2500
  y = 1500
  prompt = '唯一裤子商品输入：上传后会同时连接到 8 个固定场景。'
  status = 'idle'
  model = 'Upload'
  aspectRatio = 'Auto'
  resolution = 'Auto'
  parentIds = @()
  outputCount = 1
})

for ($index = 0; $index -lt $sceneDefinitions.Count; $index++) {
  $scene = $sceneDefinitions[$index]
  $column = $index % 4
  $row = [math]::Floor($index / 4)
  $baseX = -850 + ($column * 1500)
  $baseY = -500 + ($row * 2200)
  $anchorId = New-Id
  $generatorId = New-Id
  $groupId = New-Id
  $media = $sceneMedia[$scene.File]
  $mediaUrl = if ($media.url) {
    $media.url
  } else {
    "/api/vela/projects/$projectId/media/$($media.id)/file"
  }

  $nodes.Add([pscustomobject]@{
    id = $anchorId
    type = 'Image'
    kind = 'image-input'
    title = "固定场景 $($scene.Number)｜$($scene.Name)（勿替换）"
    x = $baseX
    y = $baseY
    prompt = '锁定背景底图：不得改变机位、构图、光线、物件位置和环境旧化细节。'
    status = 'success'
    model = 'Fixed Scene'
    aspectRatio = '3:4'
    resolution = '1086×1448'
    resultAspectRatio = '3/4'
    resultUrl = $mediaUrl
    uploadProgress = 100
    uploadSource = 'canvas-drop'
    parentIds = @()
    outputCount = 1
    groupId = $groupId
  })

  $numberedVariants = for ($variantIndex = 0; $variantIndex -lt $scene.Variants.Count; $variantIndex++) {
    "$($variantIndex + 1). $($scene.Variants[$variantIndex])"
  }
  $scenePrompt = "$commonPrompt`nLOCKED SCENE $($scene.Number): $($scene.Name).`nWARDROBE AND ACTION VARIANTS:`n$($numberedVariants -join "`n")"

  $nodes.Add([pscustomobject]@{
    id = $generatorId
    type = 'Image'
    kind = 'gpt-image'
    title = "YMAN 场景 $($scene.Number)｜$($scene.Name)（5张）"
    x = $baseX + 570
    y = $baseY + 920
    prompt = $scenePrompt
    status = 'idle'
    model = 'GPT Image'
    imageModel = 'gpt-image-2'
    profileId = $profileId
    aspectRatio = '3:4'
    resolution = '2K'
    stylePreset = 'photo'
    parentIds = @($pantsInputId, $anchorId)
    outputCount = 5
    groupId = $groupId
  })

  $groups.Add([pscustomobject]@{
    id = $groupId
    nodeIds = @($anchorId, $generatorId)
    label = "场景 $($scene.Number)｜$($scene.Name)｜固定背景 × 5动作"
  })
}

$sampleNodes = @($project.nodes | Where-Object { $_.title -like '买家秀真实版*' -or $_.title -like '参考效果*' } | Select-Object -First 5)
if ($sampleNodes.Count -gt 0) {
  $sampleGroupId = New-Id
  $sampleIds = @()
  for ($sampleIndex = 0; $sampleIndex -lt $sampleNodes.Count; $sampleIndex++) {
    $sample = $sampleNodes[$sampleIndex]
    $sample.title = "参考效果 $($sampleIndex + 1)｜已确认真实买家秀"
    $sample.x = -850 + ($sampleIndex * 750)
    $sample.y = 4300
    $sample.parentIds = @()
    $sample | Add-Member -NotePropertyName groupId -NotePropertyValue $sampleGroupId -Force
    $sampleIds += $sample.id
    $nodes.Add($sample)
  }
  $groups.Add([pscustomobject]@{
    id = $sampleGroupId
    nodeIds = $sampleIds
    label = '已确认效果参考（保留，不参与生成）'
  })
}

$settings = [ordered]@{}
foreach ($property in $project.settings.PSObject.Properties) {
  $settings[$property.Name] = $property.Value
}
$settings['buyerShowcaseVersion'] = 'workflow-v1'
$settings['pantsInputNodeId'] = $pantsInputId
$settings['sceneCount'] = 8
$settings['outputsPerScene'] = 5
$settings['totalOutputs'] = 40
$settings['profileId'] = $profileId
$settings['profileName'] = 'YMAN 主账户'
$settings['imageModel'] = 'gpt-image-2'
$settings['promptDocument'] = $promptDocument
$settings['sceneStrategy'] = 'fixed-background-plus-prompt'

$payload = [ordered]@{
  schemaVersion = $project.schemaVersion
  id = $project.id
  name = $project.name
  createdAt = $project.createdAt
  updatedAt = $project.updatedAt
  nodes = @($nodes)
  groups = @($groups)
  viewport = [ordered]@{ x = 530; y = 170; zoom = 0.16 }
  settings = $settings
}

$saved = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId" -Method Put -Body $payload
$mediaAfter = Invoke-VelaJson -Uri "$baseUrl/api/vela/projects/$projectId/media" -Method Get

$generatorNodes = @($saved.nodes | Where-Object { $_.kind -eq 'gpt-image' })
$anchorNodes = @($saved.nodes | Where-Object { $_.model -eq 'Fixed Scene' })
$inputNodes = @($saved.nodes | Where-Object { $_.id -eq $pantsInputId })
$sampleNodesAfter = @($saved.nodes | Where-Object { $_.title -like '参考效果*' })

[pscustomobject]@{
  ProjectId = $saved.id
  ProjectName = $saved.name
  TotalNodes = $saved.nodes.Count
  TotalGroups = $saved.groups.Count
  MediaCount = $mediaAfter.Count
  PantsInputNodes = $inputNodes.Count
  FixedSceneNodes = $anchorNodes.Count
  GeneratorNodes = $generatorNodes.Count
  GeneratorOutputs = ($generatorNodes | Measure-Object -Property outputCount -Sum).Sum
  YmanGeneratorNodes = @($generatorNodes | Where-Object { $_.profileId -eq $profileId -and $_.imageModel -eq 'gpt-image-2' }).Count
  TwoParentGeneratorNodes = @($generatorNodes | Where-Object { $_.parentIds.Count -eq 2 -and $_.parentIds[0] -eq $pantsInputId }).Count
  PreservedSamples = $sampleNodesAfter.Count
  Version = $saved.settings.buyerShowcaseVersion
} | ConvertTo-Json -Depth 5
