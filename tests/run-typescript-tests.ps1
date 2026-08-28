$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$tmp = Join-Path $root '.tmp-test-build'
if (Test-Path -LiteralPath $tmp) {
    Remove-Item -LiteralPath $tmp -Recurse -Force
}
try {
    Push-Location $root
    npx tsc --outDir .tmp-test-build --noEmit false
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    node --test .tmp-test-build/tests/*.test.js
    exit $LASTEXITCODE
}
finally {
    Pop-Location
    if (Test-Path -LiteralPath $tmp) {
        $resolvedTmp = (Resolve-Path -LiteralPath $tmp).Path
        if (-not $resolvedTmp.StartsWith($root)) {
            throw "Refusing to remove temp path outside project: $resolvedTmp"
        }
        Remove-Item -LiteralPath $resolvedTmp -Recurse -Force
    }
}