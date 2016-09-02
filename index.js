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
var live_capture = function(cmd) {
  console.log('config: live_capture');
  return cmd
    .videoFilters(
    {
      filter: 'setpts',
      // In live capture, the PTS is considered to be the time when the server
      // receives the frame.
      options: ['\'RTCTIME / (TB * 1000000)\'']
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
var LiveVideo_default_processor = config(
    ffmpeg(),
    debug_command,
    live_capture,
    encoded_in('mpeg4'));
var LiveVideo = function(name) {
  var obj = {
    processor: LiveVideo_default_processor.clone().input(name),
    to: function(dst) {
      var newObj = LiveVideo(name);
      newObj.processor.output(dst);
      config(
          newObj.processor,
          typeof(dst) === 'string' ? to_file : to_stream);
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
  return obj;
};

var VideoRecord_default_processor = config(
    ffmpeg(),
    export_video,
    to_file,
    encoded_in('mpeg4'),
    contained_in('mp4'));
var VideoRecord = function(stream) {
  var obj = {
    processor: VideoRecord_default_processor.clone().input(stream),
    export_to_file: function(path) {
      return this.processor.clone().output(path);
    }
  };
  return obj;
};

var fit_to = function(width, height) {
  return 'scale=\'min(iw*' + height + '/ih\\,' + width + ')\':\'min(' + height + '\\,ih*' + width + '/iw)\', ' +
    'pad=\'' + width + '\':\'' + height + '\':\'(' + width + '-iw)/2\':\'(' + height + '-ih)/2\'';
};

var LiveVideoMosaic = function(src_NW, src_NE, src_SW, src_SE) {
  var tempFilePath = '.tmp.in_progress.mosaic.DO_NOT_DELETE';
  var obj = {
    src: [src_NW, src_NE, src_SW, src_SE],
    export_to_file: function(path, height, width, cb) {
      if (height === undefined) {
        height = 1440;
      }
      if (width === undefined) {
        width = 1920;
      }
      cell_height = height / 2;
      cell_width = width / 2;
      this.processor = config(ffmpeg()
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
            '[tmp3][se] overlay=shortest=1:x=' + cell_width + ':y=' + cell_height + ', setpts=\'(RTCTIME-RTCSTART)/(TB*1000000)\''
        ])
        .on('start', function(cmdLn) {
          console.log('[FFMPEG] : ' + cmdLn);
        })
        .on('error', function(err, stdout, stderr) {
          console.log('LiveVideoMosaic encountered a problem: ' + err.message);
          var fn = cb || function() {};
          fn(err, stdout, stderr);
        })
        .on('end', cb || function() {}),
        to_file,
        encoded_in('mpeg4'))
        //.config(export_video)
        //.preset(export_video)
        //.config(to_file)
        //.preset(to_file)
        .output(path);
      return this;
    },
    export_to_stream: function(stream, height, width, cb) {
      this.export_to_file(tempFilePath, height, width, function(stdout, stderr) {
        console.log('LiveVideoMosaic created as a temporary file: ' + tempFilePath);
        console.log('Streaming temporary mosaic file "' + tempFilePath + '" ...');
        fs.createReadStream(tempFilePath)
          .on('end', function() {
            console.log('Streaming of the mosaicked video file "' + tempFilePath + '" finished.');
            console.log('Removing temporary file for mosaic video: "' + tempFilePath + '" ...');
            fs.unlink(tempFilePath, function(err) {
              if (err) {
                console.log('Unable to remove temporary file for mosaic video: "' + tempFilePath + '" : ' +
                    err.message);
              } else {
                console.log('Successfully removed temporary file for mosaic video: "' + tempFilePath + '"');
              }
            });
          })
          .on('error', function(err) {
            console.log('Error encountered when streaming the mosaicked video file "' + tempFilePath + '": ' + err.message);
          })
          .pipe(stream);
      });
      return this;
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
  return obj;
};

module.exports.LiveVideo = LiveVideo;
module.exports.VideoRecord = VideoRecord;
module.exports.LiveVideoMosaic = LiveVideoMosaic;
