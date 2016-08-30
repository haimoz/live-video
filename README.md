# live-video
A node.js module to handle recording, exporting, and mosaicking of live videos on the network.

## Motivation

This module takes care of the following issues in managing live video streams
from the server:

1. Some live streams lack protocol-level timestamps, e.g., MJPEG (Motion JPEG)
   does not have timestamps, making it difficult to create videos with proper
   playback speed.

   This issue is worked around by setting per-frame timestamp as the wall-clock
   time when the server receives the frame.  FFMPEG (fluent-ffmpeg module in
   npm) is used to perform this operation.

2. Many databases (e.g., MongoDB) support streaming.  This would enable the
   live video data to be encoded on-the-fly and directly streamed into the
   database, without having to save to the file system.  However, since the
   data is streamed, the container/encapsulation/muxer is unable to support
   seeking.

   This module handles this issue by saving the video data to the database as
   unseekable streams, and adding a seekable container when exporting as a file
   to be served.

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
methods:

#### `processor`

The FFMPEG command associated with the live video (for filtering, encoding, and
muxing).  You can explicitly control the video production process through this
property.  See more details at
[fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg).

#### `to(dst)`

Declares the destination of the live video source.  If `dst` is a
file path, a seekable video file will be saved to the file system, when the
`start()` method is called on this object.  If `dst` is a writable stream, the
unseekable video data will be streamed, when the `start()` method is called on
this object.  The `LiveVideo` object itself is returned to enable chaining.

#### `start()`

Start streaming/saving from the live video source.  The object is returned to
enable chaining.

#### `stop()`

Manually stop the capturing from the live video source.  The object is returned
to enable chaining.

### `VideoRecord(stream)`

Declared a stream to be a video record that could be exported as a file.  The
`stream` parameter is a readable stream (e.g., from MongoDB).

This function returns a `VideoRecord` object with the following properties and
methods:

#### `processor`

The FFMPEG command associated with the video processing.

#### `export_to_file(path)`

Export the streamed data to a video file.  The exported file will be seekable
(as compared to the unseekable stream stored in the database).  The PTS of the
exported file will start from zero to ensure proper playback.

Returns the FFMPEG command that is cloned from `VideoRecord.processor` and
executed to export the specified file.

### `VideoMosaic(stream_NW, stream_NE, stream_SW, stream_SE)`

Declare a video mosaic consisting of four video streams.  The four video
streams would be synchronize on their presentation timestamps (PTS), as
described in the "Motivation" section.

This function returns a `VideoMosaic` object with the following properties and
methods:

#### `streams`

The four streams for the video mosaicking, in the compass order of NW, NE, SW,
and SE.

#### `export_to_file(path[, height=1920, width=1080])`

Export a video mosaic of the four input streams, synchronized on capture time.

The `height` and `width` parameters specify the resolution of the output video.

Returns the FFMPEG command that processes the four input streams into the
mosaic video.
