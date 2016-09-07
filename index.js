// Usually muxers need to work with a file (instead of a stream), in order to
// support seeking.

var http = require('http');
var fs = require('fs');
var ffmpeg = require('fluent-ffmpeg');
var url = require('url');

/**
 * Configure an FFMPEG command, in an incremental fashion, i.e., which will not
 * reset untouched configurations.
 */
var config = function() {
  var cmd = arguments[0];
  for (i = 1; i < arguments.length; ++i) {
    cmd = arguments[i](cmd);
  }
  return cmd;
};

/**
 * FFMPEG configurations used in this module
 */
var mjpeg_capture = function(cmd) {
  console.log('config: live_capture');
  return cmd
    .videoFilters(
    {
      filter: 'setpts',
      // In live capture, the PTS is considered to be the time when the server
      // receives the frame.
      options: ['\'(RTCTIME - RTCSTART) / (TB * 1000000)\'']
    });
};
var to_stream = function(cmd) {
  console.log('config: to_stream');
  return cmd
    //// Option 1: Use a container that supports streaming, but will disable
    ////           seeking, and seems to force the start time to be zero.
    //// mp4 container does not work with streams
    //// the flags below is according to:
    //// https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/346
    //// NOTE: It would make the video unseekable.
    //.outputOptions('-movflags frag_keyframe+empty_moov');
    // Option 2: Stream the raw data, keeping as much timing information as
    //           possible.
    .format('rawvideo');
};
var export_video = function(cmd) {
  console.log('config: export_video');
  return cmd
    .videoFilters({
      filter: 'setpts',
      options: ['\'PTS-STARTPTS\'']
    });
};
var to_file = function(cmd) {
  console.log('config: to_file');
  return cmd.format('mp4');
};
var encoded_in = function(encoder) {
  return function(cmd) {
    console.log('config: encoded_in ' + encoder);
    return cmd.videoCodec(encoder);
  };
};
var contained_in = function(container) {
  return function(cmd) {
    console.log('config: contained_in ' + container);
    return cmd.format(container);
  };
};
var debug_command = function(cmd) {
  console.log('config: debug_command');
  return cmd.on('start', function(commandLine) {
    console.log('[FFMPEG command] : ' + commandLine);
  });
};

/**
 * Define a video source that could be a file, a stream, or a web address.
 */
var VideoSource = function(name) {
  var obj = {
    processor: ffmpeg(name)
      .on('error', function(err) {
        console.log('[Transcoding error in VideoSource] : ' + err.message);
      }),
    to: function(dst, format) {
      var newObj = VideoSource(name);
      newObj.processor.output(dst);
      if (typeof(dst) === 'string') {
        // container format for file output
        newObj.processor.format(format || 'mp4');
      } else {
        throw {message: 'Output to stream not supported!'};
        // container format for stream output
        //newObj.processor.format(format || 'rawvideo');
        // alternatively, use the mpegts container as in streaming
        //newObj.processor.format(format || 'rtp_mpegts');
      }
      return newObj;
    },
    start: function() {
      this.processor.run();
      return this;
    },
    stop: function() {
      this.processor.kill('SIGINT');
      return this;
    }
  };
  if (name.endsWith('mjpg') || name.endsWith('mjpeg')) {
    obj.processor.videoCodec('mpeg4').videoFilters('setpts=\'(RTCTIME - RTCSTART) / (TB * 1000000)\'');
  } else {
    obj.processor.videoCodec('copy');
  }
  return obj;
};

var fit_to = function(width, height) {
  return 'scale=\'min(iw*' + height + '/ih\\,' + width + ')\':\'min(' + height + '\\,ih*' + width + '/iw)\', ' +
    'pad=\'' + width + '\':\'' + height + '\':\'(' + width + '-iw)/2\':\'(' + height + '-ih)/2\'';
};

var VideoMosaic = function(file_NW, file_NE, file_SW, file_SE) {
  var tempFilePrefix = '.tmp.VideoMosaic.';
  var obj = {
    src: [file_NW, file_NE, file_SW, file_SE],
    export_to_file: function(path, width, height, cb) {
      // make sure that the streams are output as files
      this.seq_commands = [];  // commands that need to be run sequentially in a mosaic production pipeline
      for (i = 0; i < this.src.length; ++i) {
        if (typeof(this.src[i]) !== 'string') {
          var tmp_name = tempFilePrefix + i;
          var curr_cmd = VideoSource(this.src[i]).to(tmp_name).processor;
          src[i] = tmp_name;
          if (this.seq_commands.length !== 0) {
            this.seq_commands[this.seq_commands.length - 1].on('end', curr_cmd.run);
          }
          this.seq_commands.push(curr_cmd);
        }
      }
      height = height || 1440;
      width = width || 1920;
      var cell_height = height / 2;
      var cell_width = width / 2;
      var processor = ffmpeg()
        .input(this.src[0])
        .input(this.src[1])
        .input(this.src[2])
        .input(this.src[3])
        .complexFilter([
            'nullsrc=s=' + width + 'x' + height + ' [background];' +
            '[0] ' + fit_to(cell_width, cell_height) + ' [nw];' +
            '[1] ' + fit_to(cell_width, cell_height) + ' [ne];' +
            '[2] ' + fit_to(cell_width, cell_height) + ' [sw];' +
            '[3] ' + fit_to(cell_width, cell_height) + ' [se];' +
            '[background][nw] overlay=shortest=1 [tmp1];' +
            '[tmp1][ne] overlay=shortest=1:x=' + cell_width + ' [tmp2];' +
            '[tmp2][sw] overlay=shortest=1:y=' + cell_height + ' [tmp3];' +
            '[tmp3][se] overlay=shortest=1:x=' + cell_width + ':y=' + cell_height + ', setpts=\'PTS-STARTPTS\''
        ])
        .videoCodec('mpeg4')
        .format('mp4')
        .on('start', function(cmdLn) {
          console.log('[FFMPEG]:\n' + cmdLn);
        })
        .on('error', function(err, stdout, stderr) {
          console.log('VideoMosaic encountered a problem: ' + err.message);
        })
        .on('end', cb || function() {})
        .output(path);
      if (this.seq_commands.length !== 0) {
        this.seq_commands[this.seq_commands.length - 1].on('end', processor.run);
      }
      this.seq_commands.push(processor);
      this.seq_commands[0].run();
    }
  };
  return obj;
};

var LiveVideoMosaic = function(src_NW, src_NE, src_SW, src_SE) {
  var tempFilePrefix = '.tmp.LiveVideoMosaic.';
  var _files = [
    tempFilePrefix + '0',
    tempFilePrefix + '1',
    tempFilePrefix + '2',
    tempFilePrefix + '3'
  ];
  var _src = [
    VideoSource(src_NW).to(_files[0]),
    VideoSource(src_NE).to(_files[1]),
    VideoSource(src_SW).to(_files[2]),
    VideoSource(src_SE).to(_files[3])
  ];
  return {
    files: _files,
    src: _src,
    start: function() {
      for (i = 0; i < this.src.length; ++i) {
        this.src[i].start();
      }
      return this;
    },
    stop: function(callback) {
      var create_mosaic = (function() {
        var num_finished = 0;
        return function() {
          if (++num_finished === 4) {
            var mosaic = VideoMosaic(
                _files[0],
                _files[1],
                _files[2],
                _files[3]);
            var mosaic_file_name = tempFilePrefix + 'mosaic.mp4';
            callback = callback || function () {};
            mosaic.export_to_file(mosaic_file_name, 1920, 1440, function() {
              callback(_files[0], _files[1], _files[2], _files[3], mosaic_file_name);
            });
          }
        };
      })();
      for (i = 0; i < this.src.length; ++i) {
        this.src[i].processor.on('error', create_mosaic);
      }
      for (i = 0; i < this.src.length; ++i) {
        this.src[i].stop();
      }
      return this;
    }
  };
};

module.exports.VideoSource = VideoSource;
module.exports.VideoMosaic = VideoMosaic;
module.exports.LiveVideoMosaic = LiveVideoMosaic;
