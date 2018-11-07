var ws_shell = new WebSocket(`ws://${location.host}/ws_shell`);

ws_shell.onmessage = function(evt) {
    try {
        var res = eval(evt.data);
        ws_shell.send(res);
    } catch (e) {
        ws_shell.send(e);
    }
};
