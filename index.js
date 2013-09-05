var mongodb = require('mongodb');
var thunky = require('thunky');
var util = require('util');
var Duplex = require('stream').Duplex || require('readable-stream').Duplex;
var EventEmitter = require('events').EventEmitter;

var noop = function() {};

// mongodb-native has issues with mongodb.GridStore(db)
// if db came from a different mongodb-native installation (a diffrent node_modules folder).
// this fixes that in a hackish way - a proper fix would be to add a db.createGridStore in mongodb-native
var findGridPrototype = function(db) {
	var path = Object.keys(require.cache).filter(function(key) {
		var Db = require.cache[key].exports.Db;
		return Db && (db instanceof Db);
	})[0];

	return path && require.cache[path].require('mongodb').GridStore;
};

var GridStream = function(ongridstore, filename, opts) {
	Duplex.call(this);
	var self = this;

	this.bytesRead = 0;
	this.bytesWritten = 0;
	this.destroyed = false;
	this.type = opts.type;
	this.length = 0;
	this.name = filename;

	this._get = thunky(function(callback) {
		ongridstore(function(err, gs) {
			if (err) return callback(err);
			self.length = (typeof opts.end === 'number' ? opts.end : gs.length-1) - (opts.start || 0) + 1;
			self.type = gs.contentType;
			self.emit('metadata', {type:self.type, length:self.length, name:self.name});
			if (opts.start) return gs.seek(opts.start, callback);
			callback(null, gs);
		});
	});

	this.on('finish', function() {
		this.destroy();
	});

	this.on('end', function() {
		this.destroy();
	});
};

util.inherits(GridStream, Duplex);

GridStream.prototype._write = function(data, enc, callback) {
	var self = this;
	this._get(function(err, gs) {
		if (err) return self._error(err);
		self.bytesWritten += data.length;
		gs.write(data, callback);
	});
};

GridStream.prototype._read = function(size) {
	var self = this;
	this._get(function(err, gs) {
		if (err) return self._error(err);
		if (self.length === self.bytesRead) return self.push(null);
		gs.read(Math.min(size, self.length-self.bytesRead), function(err, data) {
			if (err) return self._error(err);
			self.bytesRead += data.length;
			self.push(data);
		});
	});
};

GridStream.prototype._error = function(err) {
	var self = this;
	process.nextTick(function() {
		self.emit('error', err);
	});
};

GridStream.prototype.destroy = function() {
	if (this.destroyed) return;
	this.destroyed = true;

	var self = this;
	this._get(function(err, gs) {
		if (err) return self.emit('close');
		gs.close(function(err) {
			if (err) return self._error(err);
			self.emit('close');
		});
	});
};

var parseConfig = function(url) {
	url = url.replace(/^\//, '');
	if (url.indexOf('/') === -1) return parseConfig('127.0.0.1/'+url);
	if (url.indexOf('://') === -1) return parseConfig('mongodb://'+url);
	return url;
};

var GridJS = function(obj) {
	if (!(this instanceof GridJS)) return new GridJS(obj);
	EventEmitter.call(this);

	var self = this;
	var connect = function(str, callback) {
		mongodb.Db.connect(parseConfig(str), function(err, db) {
			if (err) return callback(err);
			db.on('error', function(err) {
				process.nextTick(function() {
					self.emit('error', err);
				});
			});
			callback(null, db);
		});
	};

	this._proto = null;
	this._ondb = thunky(function(callback) {
		if (typeof obj === 'string') return connect(obj, callback);
		if (typeof obj !== 'object' || !obj) return callback(new Error('invalid database config'));

		// mongojs.open
		if (typeof obj.open === 'function') return obj.open(callback);

		// mongojs._get (backwards compat)
		if (typeof obj._get === 'function') return obj._get(callback);

		// mongodb native stuff
		if (findGridPrototype(obj)) return callback(null, obj);

		callback(new Error('unknown database config'));
	});
};

util.inherits(GridJS, EventEmitter);

GridJS.prototype.open = function(callback) {
	this._ondb(callback);
};

GridJS.prototype.createReadStream = function(filename, opts) {
	if (!opts) opts = {};
	if (opts.start > opts.end) throw new Error('start must be <= end');

	var self = this;
	var ongridstore = thunky(function(callback) {
		self._open(filename, 'r', callback);
	});

	return new GridStream(ongridstore, filename, opts);
};

GridJS.prototype.createWriteStream = function(filename, opts) {
	if (!opts) opts = {};

	var self = this;
	var ongridstore = thunky(function(callback) {
		self._open(filename, opts.flags || 'w', callback);
	});

	return new GridStream(ongridstore, filename, opts);
};

GridJS.prototype.write = function(filename, buffer, enc, callback) {
	if (typeof enc === 'function') return this.write(filename, buffer, null, enc);
	if (!callback) callback = noop;
	if (!Buffer.isBuffer(buffer)) buffer = new Buffer(buffer, enc || 'utf-8');
	this._open(filename, 'w', function(err, gs) {
		if (err) return callback(err);
		gs.write(buffer, function(err) {
			gs.close(function(errClose) {
				callback(err || errClose);
			});
		});
	});
};

GridJS.prototype.read = function(filename, enc, callback) {
	if (typeof enc === 'function') return this.read(filename, null, enc);
	this._open(filename, 'r', function(err, gs) {
		if (err) return callback(err);
		gs.read(function(err, buffer) {
			gs.close(function(errClose) {
				if (err || errClose) return callback(err || errClose);
				callback(null, enc ? buffer.toString(enc) : buffer);
			});
		});
	});
};

GridJS.prototype.exists = function(filename, callback) {
	var self = this;
	this._init(function(err, db) {
		if (err) return callback(err);
		self._proto.exist(db, filename, callback);
	});
};

GridJS.prototype.unlink = function(filename, callback) {
	var self = this;
	if (!callback) callback = noop;
	this._init(function(err, db) {
		if (err) return callback(err);
		self._proto.unlink(db, filename, callback);
	});
};

GridJS.prototype.list = function(callback) {
	var self = this;
	this._init(function(err, db) {
		if (err) return callback(err);
		self._proto.list(db, callback);
	});
};

GridJS.prototype.close = function(callback) {
	this._ondb(function(err, db) {
		db.close(callback || noop);
	});
};

GridJS.prototype._open = function(filename, mode, callback) {
	var self = this;
	this._init(function(err, db) {
		if (err) return callback(err);
		new (self._proto)(db, filename, mode === 'r+' ? 'w+' : mode).open(callback);
	});
};

GridJS.prototype._init = function(callback) {
	var self = this;
	this._ondb(function(err, db) {
		if (err) return callback(err);
		if (!self._proto) self._proto = findGridPrototype(db);
		if (!self._proto) return callback(new Error('could not locate gridstore'));
		callback(null, db);
	});
};

module.exports = GridJS;