var ws_log = new WebSocket(`ws://${location.host}/ws_log`);

var logging_ready = new Promise(function(resolve, reject) {
    ws_log.onopen = function() {
        resolve();
    }
    ws_log.onerror = function(err) {
        reject(err);
    };
});
ready = Promise.all([ready, logging_ready]);

print = function(msg) {
    try {
        ws_log.send(msg);
    } catch (e) {}
    document.body.innerText += msg + '\n';
}
