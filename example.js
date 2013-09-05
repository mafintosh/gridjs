var gridjs = require('./index')
var gs = gridjs('test');
var fs = require('fs');

var read = function(callback) {
	var inp = gs.createReadStream('test.js');

	inp.pipe(process.stdout);
	inp.on('end', callback);
};

var write = function(callback) {
	var out = gs.createWriteStream('test.js');

	fs.createReadStream(__filename).pipe(out);
	out.on('close', callback);
};

write(function() {
	read(function() {
		gs.close();
	});
});
