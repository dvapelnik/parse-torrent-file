module.exports = decodeTorrentFile
module.exports.decode = decodeTorrentFile
module.exports.encode = encodeTorrentFile

var bencode = require('bencode')
var path = require('path')
var sha1 = require('simple-sha1')

/**
 * Parse a torrent. Throws an exception if the torrent is missing required fields.
 * @param  {Buffer|Object} torrent
 * @return {Object}        parsed torrent
 */
function decodeTorrentFile(torrent) {
  if (Buffer.isBuffer(torrent)) {
    torrent = bencode.decode(torrent)
  }

  // sanity check
  ensure(torrent.info, 'info')
  ensure(torrent.info.name, 'info.name')
  ensure(torrent.info['piece length'], 'info[\'piece length\']')
  ensure(torrent.info.pieces, 'info.pieces')

  // is torrent file with multiple shared files
  if (torrent.info.files) {
    torrent.info.files.forEach(function (file) {
      ensure(typeof file.length === 'number', 'info.files[0].length')
      ensure(file.path, 'info.files[0].path')
    })
  } else {
    ensure(typeof torrent.info.length === 'number', 'info.length')
  }

  var result = {}
  result.info = torrent.info
  result.infoBuffer = bencode.encode(torrent.info)
  result.infoHash = sha1.sync(result.infoBuffer)

  result.name = torrent.info.name.toString()
  result.private = torrent.info.private === undefined ? false : !!torrent.info.private

  if (torrent['publisher']) result.publisher = torrent['publisher'].toString()
  if (torrent['publisher-url']) result.publisherUrl = torrent['publisher-url'].toString()

  if (torrent['created by']) result.creator = torrent['created by'].toString()
  if (torrent['creation date']) result.created = new Date(torrent['creation date'] * 1000)

  result.encoding = torrent.encoding
    ? torrent.encoding.toString()
    : 'UTF-8';

  if (Buffer.isBuffer(torrent.comment)) result.comment = torrent.comment.toString()

  // announce/announce-list may be missing if metadata fetched via ut_metadata extension
  var announce = torrent['announce-list']
  if (!announce) {
    if (torrent.announce) {
      announce = [[torrent.announce]]
    } else {
      announce = []
    }
  }

  result.announceList = announce.map(function (urls) {
    return urls.map(function (url) {
      return url.toString()
    })
  })

  result.announce = [].concat.apply([], result.announceList)

  // handle url-list (BEP19 / web seeding)
  if (Buffer.isBuffer(torrent['url-list'])) {
    // some clients set url-list to empty string
    torrent['url-list'] = torrent['url-list'].length > 0
      ? [torrent['url-list']]
      : []
  }
  result.urlList = (torrent['url-list'] || []).map(function (url) {
    return url.toString()
  })

  var files = torrent.info.files || [torrent.info]
  result.files = files.map(function (file, i) {
    var parts = [].concat(file.name || result.name, file.path || []).map(function (p) {
      return p.toString()
    })
    return {
      path: path.join.apply(null, [path.sep].concat(parts)).slice(1),
      name: parts[parts.length - 1],
      length: file.length,
      offset: files.slice(0, i).reduce(sumLength, 0)
    }
  })

  result.length = files.reduce(sumLength, 0)

  var lastFile = result.files[result.files.length - 1]

  result.pieceLength = torrent.info['piece length']
  result.lastPieceLength = ((lastFile.offset + lastFile.length) % result.pieceLength) || result.pieceLength
  result.pieces = splitPieces(torrent.info.pieces, result.encoding.toLowerCase().replace('-', ''))

  return result
}

/**
 * Convert a parsed torrent object back into a .torrent file buffer.
 * @param  {Object} parsed parsed torrent
 * @return {Buffer}
 */
function encodeTorrentFile(parsed) {
  var torrent = {
    info: parsed.info
  };

  ensure(parsed.info, 'info');
  ensure(parsed.info.name, 'info.name');
  ensure(parsed.info['piece length'], 'info[\'piece length\']');
  ensure(parsed.info.pieces, 'info.pieces');

  if (parsed.info.files) {
    parsed.info.files.forEach(function (file) {
      ensure(typeof file.length === 'number', 'info.files[0].length')
      ensure(file.path, 'info.files[0].path')
    })
  } else {
    ensure(typeof parsed.info.length === 'number', 'info.length')
  }

  if (parsed.announce && parsed.announce[0]) {
    torrent.announce = parsed.announce[0]
  }

  if (parsed.announceList) {
    torrent['announce-list'] = parsed.announceList.map(function (urls) {
      return urls.map(function (url) {
        url = new Buffer(url, 'utf8')
        if (!torrent.announce) {
          torrent.announce = url
        }
        return url
      })
    })
  }

  if (parsed.comment) torrent.comment = new Buffer(parsed.comment, 'utf8')

  if (parsed.encoding) torrent.encoding = new Buffer(parsed.encoding, 'utf8')

  if (parsed.publisher) torrent['publisher'] = new Buffer(parsed.publisher, 'utf8')
  if (parsed.publisherUrl) torrent['publisher-url'] = new Buffer(parsed.publisherUrl, 'utf8')

  if (parsed.creator) torrent['created by'] = new Buffer(parsed.creator, 'utf8')

  if (!parsed.created) parsed.created = new Date()
  torrent['creation date'] = (parsed.created.getTime() / 1000) | 0

  if (parsed.private !== undefined) torrent.info.private = +parsed.private

  return bencode.encode(torrent)
}

function sumLength(sum, file) {
  return sum + file.length
}

function splitPieces(pieceBuffer, encoding) {
  var hashString = pieceBuffer.toString(encoding)
  var pieces = []
  for (var i = 0; i < hashString.length; i += 20) {
    pieces.push(hashString.slice(i, i + 20).toString('hex'))
  }
  return pieces
}

function ensure(bool, fieldName) {
  if (!bool) throw new Error('Torrent is missing required field: ' + fieldName)
}
