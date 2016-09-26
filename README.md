# live-video
A node.js module to handle recording, exporting, and mosaicking of live videos
on the network.

## Work-in-progress Usage

```javascript
var lv = require('live-video');

// Set up the four sources for video mosaicing
var m = lv.LiveVideoMosaic(
    'http://www.a.com/v',
    'rtsp://www.b.com:8554/v',
    'rtmp://www.c.com/channel:user:password',
    'http://www.d.com/v.mjpg',
    'path/of/file/to/save/1st/source/to',     // If any destination file is not
    'path/of/file/to/save/2nd/source/to',     // specified, it will be saved to
    'path/of/file/to/save/3rd/source/to',     // a temporary file.
    'path/of/file/to/save/4th/source/to',
    'path/of/file/to/save/video/mosaic/to');

// When the video mosaic is asked to start, it merely starts saving the sources
// (file, network, or stream) to four local files.
m.start();

// Upon stopping, the four local files will be saved.  Then another `ffmpeg`
// process starts creating the mosaic video from the four separate videos.
// The callback function for the `stop` method received the paths of the four
// separate video files, and the path of the mosaic video.
setTimeout(function() {
  m.stop(function(v0, v1, v2, v3, v) {
    console.log('Upper-left video file path: ' + v0);
    console.log('Upper-right video file path: ' + v1);
    console.log('Lower-left video file path: ' + v2);
    console.log('Lower-right video file path: ' + v3);
    console.log('Mosaic video file path: ' + v);
  });
  console.log('done');
});
```

**IGNORE THE REST OF THE DOCUMENT**

## Motivation

This module takes care of the following issues in managing live video streams
on the server:

1. Some live streams lack protocol-level timestamps, e.g., MJPEG (Motion JPEG)
   does not have timestamps, making it difficult to create videos with proper
   playback speed.

   This issue is worked around by setting per-frame timestamp as the wall-clock
   time when the server receives the frame.  FFMPEG (through the
   [`fluent-ffmpeg`](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg)
   module in npm) is used to perform this operation.  More specifically, the
   `setpts` filter is used to set the presentation timestamps (PTS) as
   `RTCTIME / (TB * 1000000)`.

2. Many databases (e.g., MongoDB) support streaming.  This would enable the
   live video data to be encoded on-the-fly and directly streamed into the
   database as fast as possible, and with as little computation as possible,
   without having to save to the file system.  However, since the data is
   streamed, the container/encapsulation/muxer is unable to support seeking.

   This module handles this issue by encoding and streaming the live video data
   to the database without any encapsulation, and only encapsulate the video
   when it is exported from the database.  More specifically, the live video
   data is encapsulated in the `rawvideo` format by FFMPEG, when streaming into
   the database.  When the video data is to be exported as a file, it is
   encapsulated with the format of choice (default of `mp4`), and, by default,
   with the original encoding (i.e., with the `-vcodec copy` option to FFMPEG).

3. Sometimes, different live video sources need to be synchronized on their
   capture time, e.g., in surveillance applications.

   This module handles this issue by saving the capture time (wall clock time
   on the server at capture time) as PTS (Presentation Timestamp) of the video.
   The video mosaic from multiple recorded video streams then would synchronize
   on the capture time as PTS, before rebasing the PTS to start from zero in
   the final output file.

## Usage

### `LiveVideo(name)`

Defines a source of live video stream.  The `name` parameter is the URL of the
video source.

This function returns a `LiveVideo` object with the following properties and
methods (all methods are chainable):

#### `processor`

The underlying FFMPEG command associated with the live video (for filtering,
encoding, and muxing).  You can explicitly control the video production process
through this property.  See more details about
[`fluent-ffmpeg`](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg).

#### `to(dst)`

Declares the destination of the live video source.  If `dst` is a file path, a
seekable video file will be saved to the file system; if it is a writable
stream, then the video data will be encoded on-the-fly and piped into this
writable stream without any encapsulation.

#### `start()`

Start streaming/saving from the live video source.

#### `stop()`

Manually stop the capturing from the live video source.  This is done by
sending `SIGINT` (signal 2) to the underlying FFMPEG command, which would cause
the FFMPEG process to exit normally (same as when you issue a ^C to a running
FFMPEG process).

### `VideoRecord(stream)`

Declare a stream to be a video record that could be exported as a file.  The
`stream` parameter is a readable stream (e.g., from MongoDB).

This function returns a `VideoRecord` object with the following properties and
methods:

#### `export_to_file(path)`

Export the streamed data to a video file.  The exported file will be seekable
(as compared to the unseekable stream stored in the database).  The PTS of the
exported file will start from zero to ensure proper playback.

Returns the FFMPEG command that will export the file.  The actual exporting
takes place after calling the `run()` method on this returned command, to allow
for subscribing to the events emitted during the exporting process.

### `VideoMosaic(stream_NW, stream_NE, stream_SW, stream_SE)`

Declare a video mosaic consisting of four video streams.  The four video
streams would be synchronize on their presentation timestamps (PTS), as
described in the "Motivation" section.

This function returns a `VideoMosaic` object with the following properties and
methods:

#### `streams`

The four streams for the video mosaicking, in the compass order of NW, NE, SW,
and SE.

#### `export_to_file(path[, height=1280, width=960])`

Export a video mosaic of the four input streams, synchronized on capture time.

The `height` and `width` parameters specify the resolution of the output video.

Returns the FFMPEG command that will processes the four input streams into the
mosaic video.  The actual processing takes place after calling the `run()`
method on this returned command, to allow for subscribing to the events emitted
during the exporting process.
