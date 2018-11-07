// Simple promise to be resolved when the document is loaded.
// Subsequent code can simply do
//
//      ready = Promise.all([ready, new Promise(...)]);
//
// to add more dependencies.
var ready = new Promise(function(resolve) {
    if (typeof(window) === 'undefined')
        resolve();
    else
        window.onload = function() {
            resolve();
        }
});
