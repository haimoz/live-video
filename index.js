// Usually muxers need to work with a file (instead of a stream), in order to
// support seeking.

var http = require('http');
var fs = require('fs');
var ffmpeg = require('fluent-ffmpeg');
var url = require('url');

/**
 * FFMPEG presets used in this module
 */
var live_capture = function(cmd) {
  return cmd
    .videoFilters(
    {
      filter: 'setpts',
      options: ['RTCTIME / (TB * 1000000)']  // in live capture, the PTS is considered to be the time the server receives the frame
    });
};
var to_stream = function(cmd) {
  return cmd
    // mp4 container does not work with streams
    // the fix below is according to:
    // https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/346
    // NOTE: It would make the video unseekable.
    .outputOptions('-movflags frag_keyframe+empty_moov');
};
var export_video = function(cmd) {
  return cmd
    .videoFilters({
      filter: 'setpts',
      options: ['PTS-STARTPTS']
    });
};
var to_file = function(cmd) {
  return cmd;
};
var encoded_in = function(encoder='mpeg4') {
  return (cmd) => {
    return cmd.codec(encoder);
  };
};
var contained_in = function(container='mp4') {
  return (cmd) => {
    return cmd.format(container);
  };
};

/**
 * After the input and output is configured, record the video.
 */
var record = function(vid) {
  vid.processor.input(vid.input_stream);
  if (vid.dst_type === 'file') {
    return vid.processor.clone().preset(to_file).save(vid.dst);
  } else {
    return vid.processor.clone().preset(to_stream).pipe(vid.dst);
  }
};

/**
 * Define a video source that could be a file, a stream, or a web address.
 */
var LiveVideo = function(name) {
  this.src = null;
  this.dst = null;
  this.src_type = null;  // either 'http' or 'file'
  this.dst_type = null;  // either 'stream' or 'file'
  this.processor = ffmpeg().preset(encoded_in()).preset(contained_in());
  // first decide the meaning of the name
  var src_addr = url.parse(name);
  // Javascript uses strict comparison (`===`) for switch statements.
  // Therefore, it is safe to use the switch statement here.
  switch (src_addr.protocol) {
  case null:
  case 'file:':
    this.src = src_addr.path + src_addr.hash;
    this.src_type = 'file';
    break;
  case 'http:':
  case 'https:':
    this.src = src_addr.href;
    this.src_type = 'http';
    break;
  default:
    throw 'Unknown protocol "' + src_addr.protocol + '"';
  }
  this.to = function(dst) {
    this.dst = dst;
    if (typeof(dst) === 'string') {
      this.dst_type = 'file';
    } else {
      this.dst_type = 'stream';
    }
    return this;
  };
  this.start = function() {
    if (this.src_type === 'http') {
      var req = http.request(this.src, (res) => {
        this.input_stream = res;
        record(this);
      });
      req.end();
    } else {
      this.input_stream = fs.createReadStream(this.src);
      record(this);
    }
    return this;
  };
  this.stop = function() {
    this.input_stream.emit('end');
    return this;
  };
  return this;
};

var VideoRecord = function(stream) {
  this.input_stream = stream;
  this.processor = ffmpeg(stream).preset(export_video).preset(to_file);
  this.export_to_file = function(path) {
    return this.processor.clone().save(path);
  };
  return this;
};

var fit_to = function(height, width) {
  return
    'scale=min(iw*' + height + '/ih\\,' + width + '):min(' + height + '\\,ih*' + width + '/iw),' +
    'pad=' + width + ':' + height + ':(' + width + '-iw)/2:(' + height + '-ih)/2';
};

var VideoMosaic = function(stream_NW, stream_NE, stream_SW, stream_SE) {
  this.streams = [stream_NW, stream_NE, stream_SW, stream_SE];
  this.export_to_file = function(path, height=1920, width=1080) {
    cell_height = height / 2;
    cell_width = width / 2;
    return ffmpeg()
      .input(this.streams[0])
      .input(this.streams[1])
      .input(this.streams[2])
      .input(this.streams[3])
      .complexFilter([
          'nullsrc=s=' + height + 'x' + width + '[background]',
          fit_to(cell_height, cell_width) + '[nw]',
          fit_to(cell_height, cell_width) + '[ne]',
          fit_to(cell_height, cell_width) + '[sw]',
          fit_to(cell_height, cell_width) + '[se]',
          '[background][nw] overlay [tmp1]',
          '[tmp1][ne] overlay=x=' + cell_width + ' [tmp2]',
          '[tmp2][sw] overlay=y=' + cell_height + ' [tmp3]',
          '[tmp3][se] overlay=x=' + cell_width + ':y=' + cell_height
      ])
      .preset(export_video)
      .preset(to_file)
      .save(path);
  };
  return this;
};

module.exports.LiveVideo = LiveVideo;
module.exports.VideoRecord = VideoRecord;
module.exports.VideoMosaic = VideoMosaic;
