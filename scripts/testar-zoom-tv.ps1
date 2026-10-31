# Ajusta a densidade do /monitor, mantendo a pagina pai e o iframe em tamanho integral.
# Nao recompila/reinstala o APK. Executar manualmente com o APK debug aberto.
# Exemplo: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\testar-zoom-tv.ps1 -Zoom 70
param(
    [ValidateRange(40, 150)]
    [int]$Zoom = 100,
    [string]$Device = '192.168.100.175:5555'
)

$ErrorActionPreference = 'Stop'
$script:zoomSocket = $null
$script:zoomCancellation = $null
$script:zoomCommandId = 0
$script:zoomContexts = @{}

function Send-ZoomCdpCommand([string]$Method, [hashtable]$Params = @{}) {
    $script:zoomCommandId++
    $commandId = $script:zoomCommandId
    $command = @{ id = $commandId; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 12
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($command)
    $script:zoomSocket.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $script:zoomCancellation.Token).GetAwaiter().GetResult()
    while ($true) {
        $message = [System.IO.MemoryStream]::new()
        try {
            $buffer = [byte[]]::new(8192)
            do {
                $chunk = $script:zoomSocket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $script:zoomCancellation.Token).GetAwaiter().GetResult()
                if ($chunk.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { throw 'A conexao de depuracao foi encerrada.' }
                $message.Write($buffer, 0, $chunk.Count)
            } while (-not $chunk.EndOfMessage)
            $answer = [System.Text.Encoding]::UTF8.GetString($message.ToArray()) | ConvertFrom-Json
        } finally { $message.Dispose() }
        if ($answer.method -eq 'Runtime.executionContextCreated') {
            $context = $answer.params.context
            $script:zoomContexts[[int]$context.id] = $context
        } elseif ($answer.method -eq 'Runtime.executionContextDestroyed') {
            [void]$script:zoomContexts.Remove([int]$answer.params.executionContextId)
        } elseif ($answer.method -eq 'Runtime.executionContextsCleared') {
            $script:zoomContexts.Clear()
        }
        if ($answer.id -eq $commandId) {
            if ($answer.error) { throw "Erro CDP: $($answer.error.message)" }
            if ($answer.result.exceptionDetails) { throw "Erro JavaScript: $($answer.result.exceptionDetails.text)" }
            return $answer.result
        }
    }
}

function Get-ZoomFrames($Tree) {
    $Tree.frame
    foreach ($child in $Tree.childFrames) { Get-ZoomFrames $child }
}

try {
    $processIds = & adb -s $Device shell pidof com.softcom.tviframetester 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel consultar o APK: $processIds" }
    $appProcessId = (($processIds | Out-String).Trim() -split '\s+')[0]
    if ($appProcessId -notmatch '^\d+$') { throw 'Deixe o TV Iframe Tester debug aberto na TV.' }
    $socketName = "webview_devtools_remote_$appProcessId"
    $forward = & adb -s $Device forward tcp:9222 "localabstract:$socketName" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Falha ao configurar a conexao local: $forward" }
    $targets = @(Invoke-RestMethod -Uri 'http://127.0.0.1:9222/json/list' -TimeoutSec 8)
    $target = $targets | Where-Object { $_.type -eq 'page' -and $_.url -like '*appassets.androidplatform.net*' -and $_.webSocketDebuggerUrl } | Select-Object -First 1
    if (-not $target) {
        $target = $targets | Where-Object { $_.type -eq 'page' -and $_.url -match '/monitor(?:[/?#]|$)' -and $_.webSocketDebuggerUrl } | Select-Object -First 1
    }
    if (-not $target) { throw 'Nao encontrei a pagina pai do APK ou o /monitor para inspecao.' }
    $script:zoomSocket = [System.Net.WebSockets.ClientWebSocket]::new()
    $script:zoomCancellation = [System.Threading.CancellationTokenSource]::new()
    $script:zoomCancellation.CancelAfter(20000)
    $script:zoomSocket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $script:zoomCancellation.Token).GetAwaiter().GetResult()
    [void](Send-ZoomCdpCommand 'Runtime.enable')
    $tree = Send-ZoomCdpCommand 'Page.getFrameTree'
    $monitorFrame = Get-ZoomFrames $tree.frameTree | Where-Object { $_.url -match '^https?://[^/]+/monitor(?:[/?#]|$)' } | Select-Object -First 1
    if (-not $monitorFrame) { throw 'O iframe do /monitor ainda nao esta carregado. Nenhum zoom foi aplicado.' }
    $monitorContext = $script:zoomContexts.Values | Where-Object { $_.auxData.isDefault -and $_.auxData.frameId -eq $monitorFrame.id } | Select-Object -First 1
    if (-not $monitorContext) { throw 'Nao encontrei o contexto do /monitor. O zoom nao sera aplicado a pagina pai.' }
    if ($monitorFrame.id -ne $tree.frameTree.frame.id) {
        $parentContext = $script:zoomContexts.Values | Where-Object { $_.auxData.isDefault -and $_.auxData.frameId -eq $tree.frameTree.frame.id } | Select-Object -First 1
        if (-not $parentContext) { throw 'Nao encontrei o contexto da pagina pai para restaurar o tamanho do iframe.' }
        [void](Send-ZoomCdpCommand 'Runtime.evaluate' @{ contextId = $parentContext.id; returnByValue = $true; expression = "document.documentElement.style.zoom = '100%';" })
    }
    $expression = @'
(function () {
    if (!/^\/monitor(?:\/|$)/.test(location.pathname)) throw new Error('O contexto selecionado nao pertence ao monitor.');
    document.documentElement.style.zoom = '__ZOOM__';
    return JSON.stringify({ zoom: document.documentElement.style.zoom, page: location.origin + location.pathname, innerWidth: innerWidth, innerHeight: innerHeight });
})()
'@
    $expression = $expression.Replace('__ZOOM__', "$Zoom%")
    $result = Send-ZoomCdpCommand 'Runtime.evaluate' @{ contextId = $monitorContext.id; expression = $expression; returnByValue = $true }
    Write-Host "ZOOM DO PULSE: $Zoom% (iframe pai mantido em 100%)" -ForegroundColor Green
    Write-Host $result.result.value
    Write-Host 'Alteracao temporaria; nao foi necessario recompilar o APK.'
} catch {
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($script:zoomSocket) { $script:zoomSocket.Dispose() }
    if ($script:zoomCancellation) { $script:zoomCancellation.Dispose() }
}
