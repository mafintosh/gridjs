# gridjs

A GridFS module that is easy to use and [mongojs](https://github.com/mafintosh/mongjs) compliant.
It is available through npm

	npm install gridjs

## Usage

It is easy to use

### Connecting to Mongo/GridFS

To get started pass a connection string or mongojs instance to the gridjs constructor

``` js
var gridjs = require('gridjs');
var fs = require('fs');

var gs = gridjs('my-connection-string');

// or using a mongojs instance

var db = mongojs('my-connection-string');
var gs = gridjs(db);

// or using a node-mongodb-native instance

mongodb.Db.connect(connectionString, function(err, db) {
	var gs = gridjs(db);
});
```

### Writing files

Writing files using gridjs is a simple as piping to `gs.createWriteStream(filename)`
which returns a [streams2 WriteStream](http://nodejs.org/api/stream.html#stream_class_stream_writable)

``` js
fs.createReadStream('any-file').pipe(gs.createWriteStream('gridfs-filename'));
```

Alternatively if you have the entire file as a single buffer you can use `gs.write(filename, buffer, [enc], callback)`

``` js
gs.write('test-file', new Buffer('hello world'), function(err) {
	console.log('file is written', err);
});
```

### Reading files

Similary when reading files you just pipe from `gs.createReadStream(filename, [options])`
which returns a [streams2 ReadStream](http://nodejs.org/api/stream.html#stream_class_stream_readable)

``` js
gs.createReadStream('gridfs-filename').pipe(process.stdout);
```

There is also a `gs.read(filename, [enc], callback)` shorthand if you want to read the entire file into a buffer

``` js
gs.read('test-file', function(err, buffer) {
	console.log('file is read', buffer);
});
```