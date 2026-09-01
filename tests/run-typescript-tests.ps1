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
        for ($attempt = 1; $attempt -le 5 -and (Test-Path -LiteralPath $resolvedTmp); $attempt++) {
            try {
                Remove-Item -LiteralPath $resolvedTmp -Recurse -Force -ErrorAction Stop
            }
            catch {
                if ($attempt -eq 5) { throw }
                Start-Sleep -Milliseconds (250 * $attempt)
            }
        }
    }
}
