param()
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$riveExecutable = (Get-Command rive -ErrorAction Stop).Source
$captureDir = Join-Path $PSScriptRoot 'build/captures'
New-Item -ItemType Directory -Force -Path $captureDir | Out-Null
Copy-Item -LiteralPath (Join-Path $projectDir 'scene.rml') -Destination (Join-Path $PSScriptRoot 'production.rml')

function Invoke-RiveChecked {
    param([string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    $result = & $riveExecutable @Arguments 2>&1
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw ($result -join "`n") }
    return ($result -join "`n")
}

Invoke-RiveChecked @($projectDir, '--verify') | Out-Null
$inspection = Invoke-RiveChecked @('inspect', $projectDir, '--summary') | ConvertFrom-Json
if ($inspection.problems.Count -ne 0) { throw ($inspection.problems | ConvertTo-Json) }
[xml]$scene = Get-Content -Raw -LiteralPath (Join-Path $projectDir 'scene.rml')
$expectedAnimations = @('anim_idle', 'anim_greeting', 'anim_listening', 'anim_thinking', 'anim_speaking', 'anim_success', 'anim_error', 'anim_reduced_motion')
$actualAnimations = @($scene.SelectNodes('//LinearAnimation') | ForEach-Object { $_.GetAttribute('name') })
if (Compare-Object $expectedAnimations $actualAnimations) { throw 'Animation contract differs.' }
$expectedInputs = @('trigger_greet', 'trigger_success', 'trigger_error', 'is_listening', 'is_thinking', 'is_speaking', 'prefers_reduced_motion')
$actualInputs = @($scene.SelectNodes('//StateMachineBool|//StateMachineTrigger') | ForEach-Object { $_.GetAttribute('name') })
if (Compare-Object $expectedInputs $actualInputs) { throw 'Input contract differs.' }
if ($scene.SelectNodes('//Image|//ImageAsset|//ScriptAsset|//Text|//AudioAsset').Count) { throw 'Unexpected non-vector asset.' }
$idMap = @{}
foreach ($element in $scene.SelectNodes('//*[@id]')) {
    $elementId = $element.GetAttribute('id')
    if ($idMap.ContainsKey($elementId)) { throw ('Duplicate ID: ' + $elementId) }
    $idMap[$elementId] = $element
}
foreach ($keyed in $scene.SelectNodes('//KeyedObject')) {
    if (-not $idMap.ContainsKey($keyed.GetAttribute('objectId'))) { throw 'Dangling animation target.' }
}
# Each animation explicitly hides accents belonging to another state, including reduced motion.
$accents = @{ ListeningWaves = 'anim_listening'; SearchOrbit = 'anim_thinking'; ResultSparkles = 'anim_success'; ResultCardSuccess = 'anim_success'; ResultCardEmpty = 'anim_error'; SorryDrop = 'anim_error' }
foreach ($accentName in $accents.Keys) {
    $accent = $scene.SelectSingleNode('//Node[@name="' + $accentName + '"]')
    if (-not $accent -or $accent.GetAttribute('opacity') -ne '0') { throw ('Accent must start hidden: ' + $accentName) }
    foreach ($animation in $scene.SelectNodes('//LinearAnimation')) {
        $opacity = $animation.SelectSingleNode('KeyedObject[@objectId="' + $accent.GetAttribute('id') + '"]/KeyedProperty[@propertyKey="18"]')
        if (-not $opacity) { throw ('Missing accent reset in ' + $animation.GetAttribute('name')) }
        $visibleKeys = @($opacity.SelectNodes('KeyFrameDouble') | Where-Object { [double]$_.GetAttribute('value') -gt 0 })
        if ($animation.GetAttribute('name') -eq $accents[$accentName]) {
            if ($visibleKeys.Count -eq 0) { throw ('Accent never appears: ' + $accentName) }
        } elseif ($visibleKeys.Count -gt 0) { throw ('Accent leaks into ' + $animation.GetAttribute('name')) }
    }
}
foreach ($transition in $scene.SelectNodes('//StateTransition')) {
    if (-not $idMap.ContainsKey($transition.GetAttribute('stateToId'))) { throw 'Dangling transition.' }
}
foreach ($state in $scene.SelectNodes('//AnimationState')) {
    if ($idMap[$state.GetAttribute('animationId')].LocalName -ne 'LinearAnimation') { throw 'Invalid animation target.' }
}
$reduced = $scene.SelectSingleNode('//LinearAnimation[@name="anim_reduced_motion"]')
if ($reduced.GetAttribute('loopValue') -ne 'oneShot') { throw 'Reduced motion must not loop.' }
foreach ($property in $reduced.SelectNodes('.//KeyedProperty')) {
    if ($property.ChildNodes.Count -ne 1) { throw 'Reduced motion contains changing keyframes.' }
}

$captures = @(
    @('idle', 'idle', 45), @('greeting', 'greeting', 45),
    @('listening', 'listening', 45), @('thinking', 'thinking', 45),
    @('listening-pulse', 'listening', 75), @('thinking-orbit', 'thinking', 105),
    @('speaking', 'speaking', 45), @('success', 'success', 45),
    @('error', 'error', 60), @('reduced', 'reduced_motion', 60),
    @('reduced-late', 'reduced_motion', 300),
    @('reduced-interrupt', 'reduced_interrupt', 150),
    @('speaking-priority', 'speaking', 60), @('priority', 'priority', 60),
    @('idle-start', 'idle', 0), @('idle-breath', 'idle', 135),
    @('greeting-return', 'greeting', 180), @('success-return', 'success', 180),
    @('error-return', 'error', 210), @('listening-return', 'listening', 300),
    @('thinking-return', 'thinking', 300), @('speaking-return', 'speaking', 300),
    @('success-retrigger', 'success', 285), @('reduced-release', 'reduced_interrupt', 420)
)
foreach ($capture in $captures) {
    $destination = Join-Path $captureDir ($capture[0] + '.png')
    Invoke-RiveChecked @($PSScriptRoot, ('--artboard=QA_' + $capture[1]), ('--screenshot=' + $destination), ('--advance=' + $capture[2])) | Out-Null
}
function Get-CaptureHash([string]$name) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $captureDir ($name + '.png'))).Hash
}
if ((Get-CaptureHash 'reduced') -ne (Get-CaptureHash 'reduced-late')) { throw 'Reduced motion is not static.' }
if ((Get-CaptureHash 'reduced') -ne (Get-CaptureHash 'reduced-interrupt')) { throw 'Reduced motion does not override speaking/error.' }
if ((Get-CaptureHash 'speaking-priority') -ne (Get-CaptureHash 'priority')) { throw 'Conflicting booleans do not prefer speaking.' }
if ((Get-CaptureHash 'idle-start') -eq (Get-CaptureHash 'idle-breath')) { throw 'Idle is not animated.' }
if ((Get-CaptureHash 'reduced') -eq (Get-CaptureHash 'reduced-release')) { throw 'Reduced motion did not release.' }
Write-Output ('PASS: vector-only artwork, 8 animations, 7 inputs, valid references, no inspection warnings; ' + $captures.Count + ' captures; static reduced motion, interrupt priority, speaking priority, idle motion and reduced-motion release verified.')
