/*! @license
 * Shaka Player
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

goog.provide('shaka.util.CmcdManager');

goog.require('shaka.log');


/**
 * @summary
 * A CmcdManager maintains CMCD state as well as a collection of utility
 * functions.
 */
shaka.util.CmcdManager = class {
  /**
   * @param {shaka.util.CmcdManager.PlayerInterface} playerInterface
   * @param {shaka.extern.CmcdConfiguration} config
   */
  constructor(playerInterface, config) {
    /** @private {shaka.util.CmcdManager.PlayerInterface} */
    this.playerInterface_ = playerInterface;

    /** @private {?shaka.extern.CmcdConfiguration} */
    this.config_ = config;

    /**
     * Session ID
     *
     * @private {string}
     */
    this.sid_ = config.sessionId || window.crypto.randomUUID();

    /**
     * Streaming format
     *
     * @private {(shaka.util.CmcdManager.StreamingFormat|undefined)}
     */
    this.sf_ = undefined;

    /**
     * @private {boolean}
     */
    this.playbackStarted_ = false;

    /**
    * @private {boolean}
    */
    this.buffering_ = true;

    /**
     * @private {boolean}
     */
    this.starved_ = false;
  }

  /**
   * Set the buffering state
   *
   * @param {boolean} buffering
   */
  setBuffering(buffering) {
    if (!buffering && !this.playbackStarted_) {
      this.playbackStarted_ = true;
    }

    if (this.playbackStarted_ && buffering) {
      this.starved_ = true;
    }

    this.buffering_ = buffering;
  }

  /**
   * Apply CMCD data to a manifest request.
   *
   * @param {!shaka.extern.Request} request
   *   The request to apply CMCD data to
   * @param {shaka.util.CmcdManager.ManifestInfo} manifestInfo
   *   The manifest format
   */
  applyManifestData(request, manifestInfo) {
    try {
      if (!this.config_.enabled) {
        return;
      }

      this.sf_ = manifestInfo.format;

      this.apply_(request, {
        ot: shaka.util.CmcdManager.ObjectType.MANIFEST,
        su: !this.playbackStarted_,
      });
    } catch (error) {
      shaka.log.warnOnce('CMCD_MANIFEST_ERROR',
          'Could not generate manifest CMCD data.', error);
    }
  }

  /**
   * Apply CMCD data to a segment request
   *
   * @param {!shaka.extern.Request} request
   * @param {shaka.util.CmcdManager.SegmentInfo} segmentInfo
   */
  applySegmentData(request, segmentInfo) {
    try {
      if (!this.config_.enabled) {
        return;
      }

      const data = {
        d: segmentInfo.duration * 1000,
        st: this.getStreamType_(),
      };

      data.ot = this.getObjectType_(segmentInfo);

      const isMedia = data.ot === shaka.util.CmcdManager.ObjectType.VIDEO ||
                      data.ot === shaka.util.CmcdManager.ObjectType.AUDIO ||
                      data.ot === shaka.util.CmcdManager.ObjectType.MUXED ||
                      data.ot === shaka.util.CmcdManager.ObjectType.TIMED_TEXT;

      if (isMedia) {
        data.bl = this.getBufferLength_(segmentInfo.type);
      }

      if (segmentInfo.bandwidth) {
        data.br = segmentInfo.bandwidth / 1000;
      }

      data.tb = this.getTopBandwidth_(segmentInfo.type) / 1000;

      this.apply_(request, data);
    } catch (error) {
      shaka.log.warnOnce('CMCD_SEGMENT_ERROR',
          'Could not generate segment CMCD data.', error);
    }
  }

  /**
   * Apply CMCD data to a text request
   *
   * @param {!shaka.extern.Request} request
   */
  applyTextData(request) {
    try {
      this.apply_(request, {
        ot: shaka.util.CmcdManager.ObjectType.CAPTION,
        su: true,
      });
    } catch (error) {
      shaka.log.warnOnce('CMCD_TEXT_ERROR',
          'Could not generate text CMCD data.', error);
    }
  }

  /**
   * Apply CMCD data to streams loaded via src=.
   *
   * @param {string} uri
   * @param {string} mimeType
   * @return {string}
   */
  appendSrcData(uri, mimeType) {
    try {
      if (!this.config_.enabled) {
        return uri;
      }

      const data = this.createData_();
      data.ot = this.getObjectTypeFromMimeType_(mimeType);
      data.su = true;

      const query = shaka.util.CmcdManager.toQuery(data);

      return shaka.util.CmcdManager.appendQueryToUri(uri, query);
    } catch (error) {
      shaka.log.warnOnce('CMCD_SRC_ERROR',
          'Could not generate src CMCD data.', error);
      return uri;
    }
  }

  /**
   * Apply CMCD data to side car text track uri.
   *
   * @param {string} uri
   * @return {string}
   */
  appendTextTrackData(uri) {
    try {
      if (!this.config_.enabled) {
        return uri;
      }

      const data = this.createData_();
      data.ot = shaka.util.CmcdManager.ObjectType.CAPTION;
      data.su = true;

      const query = shaka.util.CmcdManager.toQuery(data);

      return shaka.util.CmcdManager.appendQueryToUri(uri, query);
    } catch (error) {
      shaka.log.warnOnce('CMCD_TEXT_TRACK_ERROR',
          'Could not generate text track CMCD data.', error);
      return uri;
    }
  }

  /**
   * Create baseline CMCD data
   *
   * @return {shaka.util.CmcdManager.Data}
   * @private
   */
  createData_() {
    return {
      v: shaka.util.CmcdManager.Version,
      sf: this.sf_,
      sid: this.sid_,
      cid: this.config_.contentId,
      mtp: this.playerInterface_.getBandwidthEstimate() / 1000,
    };
  }

  /**
   * Apply CMCD data to a request.
   *
   * @param {!shaka.extern.Request} request The request to apply CMCD data to
   * @param {!shaka.util.CmcdManager.Data} data The data object
   * @param {boolean} useHeaders Send data via request headers
   * @private
   */
  apply_(request, data = {}, useHeaders = this.config_.useHeaders) {
    if (!this.config_.enabled) {
      return;
    }

    // apply baseline data
    Object.assign(data, this.createData_());

    data.pr = this.playerInterface_.getPlaybackRate();

    const isVideo = data.ot === shaka.util.CmcdManager.ObjectType.VIDEO ||
      data.ot === shaka.util.CmcdManager.ObjectType.MUXED;

    if (this.starved_ && isVideo) {
      data.bs = true;
      data.su = true;
      this.starved_ = false;
    }

    if (data.su == null) {
      data.su = this.buffering_;
    }

    // TODO: Implement rtp, nrr, nor, dl

    if (useHeaders) {
      const headers = shaka.util.CmcdManager.toHeaders(data);
      if (!Object.keys(headers).length) {
        return;
      }

      Object.assign(request.headers, headers);
    } else {
      const query = shaka.util.CmcdManager.toQuery(data);
      if (!query) {
        return;
      }

      request.uris = request.uris.map((uri) => {
        return shaka.util.CmcdManager.appendQueryToUri(uri, query);
      });
    }
  }

  /**
   * The CMCD object type.
   *
   * @param {shaka.util.CmcdManager.SegmentInfo} segmentInfo
   * @private
   */
  getObjectType_(segmentInfo) {
    const type = segmentInfo.type;

    if (segmentInfo.init) {
      return shaka.util.CmcdManager.ObjectType.INIT;
    }

    if (type == 'video') {
      if (segmentInfo.codecs.includes(',')) {
        return shaka.util.CmcdManager.ObjectType.MUXED;
      }
      return shaka.util.CmcdManager.ObjectType.VIDEO;
    }

    if (type == 'audio') {
      return shaka.util.CmcdManager.ObjectType.AUDIO;
    }

    if (type == 'text') {
      if (segmentInfo.mimeType === 'application/mp4') {
        return shaka.util.CmcdManager.ObjectType.TIMED_TEXT;
      }
      return shaka.util.CmcdManager.ObjectType.CAPTION;
    }

    return undefined;
  }

  /**
   * The CMCD object type from mimeType.
   *
   * @param {!string} mimeType
   * @return {(shaka.util.CmcdManager.ObjectType|undefined)}
   * @private
   */
  getObjectTypeFromMimeType_(mimeType) {
    switch (mimeType) {
      case 'video/webm':
      case 'video/mp4':
        return shaka.util.CmcdManager.ObjectType.MUXED;

      case 'application/x-mpegurl':
        return shaka.util.CmcdManager.ObjectType.MANIFEST;

      default:
        return undefined;
    }
  }

  /**
   * Get the buffer length for a media type in milliseconds
   *
   * @param {string} type
   * @return {number}
   * @private
   */
  getBufferLength_(type) {
    const ranges = this.playerInterface_.getBufferedInfo()[type];

    if (!ranges.length) {
      return NaN;
    }

    const start = this.playerInterface_.getCurrentTime();
    const range = ranges.find((r) => r.start <= start && r.end >= start);

    if (!range) {
      return NaN;
    }

    return (range.end - start) * 1000;
  }

  /**
   * Get the stream type
   *
   * @return {shaka.util.CmcdManager.StreamType}
   * @private
   */
  getStreamType_() {
    const isLive = this.playerInterface_.isLive();
    if (isLive) {
      return shaka.util.CmcdManager.StreamType.LIVE;
    } else {
      return shaka.util.CmcdManager.StreamType.VOD;
    }
  }

  /**
   * Get the highest bandwidth for a given type.
   *
   * @param {string} type
   * @return {number}
   * @private
   */
  getTopBandwidth_(type) {
    const manifest = this.playerInterface_.getManifest();
    if (!manifest) {
      return NaN;
    }

    const variants = (type === 'text') ?
      manifest.textStreams : manifest.variants;
    let top = variants[0][type] || variants[0];

    for (const variant of variants) {
      const stream = variant[type] || variant;
      if (stream.bandwidth > top.bandwidth) {
        top = stream;
      }
    }

    return top.bandwidth;
  }

  /**
   * Serialize a CMCD data object according to the rules defined in the
   * section 3.2 of
   * [CTA-5004](https://cdn.cta.tech/cta/media/media/resources/standards/pdfs/cta-5004-final.pdf).
   *
   * @param {shaka.util.CmcdManager.Data} data The CMCD data object
   * @return {string}
   */
  static serialize(data) {
    const results = [];
    const isValid = (value) =>
      !Number.isNaN(value) && value != null && value !== '' && value !== false;
    const toRounded = (value) => Math.round(value);
    const toHundred = (value) => toRounded(value / 100) * 100;
    const toUrlSafe = (value) => encodeURIComponent(value);
    const formatters = {
      br: toRounded,
      d: toRounded,
      bl: toHundred,
      dl: toHundred,
      mtp: toHundred,
      nor: toUrlSafe,
      rtp: toHundred,
      tb: toRounded,
    };

    const keys = Object.keys(data || {}).sort();

    for (const key of keys) {
      let value = data[key];

      // ignore invalid values
      if (!isValid(value)) {
        continue;
      }

      // Version should only be reported if not equal to 1.
      if (key === 'v' && value === 1) {
        continue;
      }

      // Playback rate should only be sent if not equal to 1.
      if (key == 'pr' && value === 1) {
        continue;
      }

      // Certain values require special formatting
      const formatter = formatters[key];
      if (formatter) {
        value = formatter(value);
      }

      // Serialize the key/value pair
      const type = typeof value;
      let result;

      if (type === 'string' && key !== 'ot' && key !== 'sf' && key !== 'st') {
        result = `${key}="${value.replace(/"/g, '"')}"`;
      } else if (type === 'boolean') {
        result = key;
      } else if (type === 'symbol') {
        result = `${key}=${value.description}`;
      } else {
        result = `${key}=${value}`;
      }

      results.push(result);
    }

    return results.join(',');
  }

  /**
   * Convert a CMCD data object to request headers according to the rules
   * defined in the section 2.1 and 3.2 of
   * [CTA-5004](https://cdn.cta.tech/cta/media/media/resources/standards/pdfs/cta-5004-final.pdf).
   *
   * @param {shaka.util.CmcdManager.Data} data The CMCD data object
   * @return {!Object}
   */
  static toHeaders(data) {
    const keys = Object.keys(data);
    const headers = {};
    const headerNames = ['Object', 'Request', 'Session', 'Status'];
    const headerGroups = [{}, {}, {}, {}];
    const headerMap = {
      br: 0, d: 0, ot: 0, tb: 0,
      bl: 1, dl: 1, mtp: 1, nor: 1, nrr: 1, su: 1,
      cid: 2, pr: 2, sf: 2, sid: 2, st: 2, v: 2,
      bs: 3, rtp: 3,
    };

    for (const key of keys) {
      // Unmapped fields are mapped to the Request header
      const index = (headerMap[key] != null) ? headerMap[key] : 1;
      headerGroups[index][key] = data[key];
    }

    for (let i = 0; i < headerGroups.length; i++) {
      const value = shaka.util.CmcdManager.serialize(headerGroups[i]);
      if (value) {
        headers[`CMCD-${headerNames[i]}`] = value;
      }
    }

    return headers;
  }

  /**
   * Convert a CMCD data object to query args according to the rules
   * defined in the section 2.2 and 3.2 of
   * [CTA-5004](https://cdn.cta.tech/cta/media/media/resources/standards/pdfs/cta-5004-final.pdf).
   *
   * @param {shaka.util.CmcdManager.Data} data The CMCD data object
   * @return {string}
   */
  static toQuery(data) {
    return `CMCD=${encodeURIComponent(shaka.util.CmcdManager.serialize(data))}`;
  }

  /**
   * Append query args to a uri.
   *
   * @param {string} uri
   * @param {string} query
   * @return {string}
   */
  static appendQueryToUri(uri, query) {
    if (!query) {
      return uri;
    }

    if (uri.includes('offline:')) {
      return uri;
    }

    const separator = uri.includes('?') ? '&' : '?';
    return `${uri}${separator}${query}`;
  }
};


/**
 * @typedef {{
 *   getBandwidthEstimate: function():number,
 *   getBufferedInfo: function():shaka.extern.BufferedInfo,
 *   getCurrentTime: function():number,
 *   getManifest: function():shaka.extern.Manifest,
 *   getPlaybackRate: function():number,
 *   isLive: function():boolean
 * }}
 *
 * @property {function():number} getBandwidthEstimate
 *   Get the estimated bandwidth in bits per second.
 * @property {function():shaka.extern.BufferedInfo} getBufferedInfo
 *   Get information about what the player has buffered.
 * @property {function():number} getCurrentTime
 *   Get the current time
 * @property {function():shaka.extern.Manifest} getManifest
 *   Get the manifest
 * @property {function():number} getPlaybackRate
 *   Get the playback rate
 * @property {function():boolean} isLive
 *   Get if the player is playing live content.
 */
shaka.util.CmcdManager.PlayerInterface;


/**
 * @typedef {{
 *   type: string,
 *   init: boolean,
 *   duration: number,
 *   mimeType: string,
 *   codecs: string,
 *   bandwidth: (number|undefined)
 * }}
 *
 * @property {string} type
 *   The media type
 * @property {boolean} init
 *   Flag indicating whether the segment is an init segment
 * @property {number} duration
 *   The duration of the segment in seconds
 * @property {string} mimeType
 *   The segment's mime type
 * @property {string} codecs
 *   The segment's codecs
 * @property {(number|undefined)} bandwidth
 *   The segment's variation bandwidth
 *
 * @export
 */
shaka.util.CmcdManager.SegmentInfo;


/**
 * @typedef {{
 *   format: shaka.util.CmcdManager.StreamingFormat
 * }}
 *
 * @property {shaka.util.CmcdManager.StreamingFormat} format
 *   The manifest's stream format
 *
 * @export
 */
shaka.util.CmcdManager.ManifestInfo;


/**
 * @typedef {{
 *   br: (number|undefined),
 *   d: (number|undefined),
 *   ot: (shaka.util.CmcdManager.ObjectType|undefined),
 *   tb: (number|undefined),
 *   bl: (number|undefined),
 *   dl: (number|undefined),
 *   mtp: (number|undefined),
 *   nor: (string|undefined),
 *   nrr: (string|undefined),
 *   su: (boolean|undefined),
 *   cid: (string|undefined),
 *   pr: (number|undefined),
 *   sf: (shaka.util.CmcdManager.StreamingFormat|undefined),
 *   sid: (string|undefined),
 *   st: (shaka.util.CmcdManager.StreamType|undefined),
 *   v: (number|undefined),
 *   bs: (boolean|undefined),
 *   rtp: (number|undefined)
 * }}
 *
 * @description
 *   Client Media Common Data (CMCD) data.
 *
 * @property {number} br
 *   The encoded bitrate of the audio or video object being requested. This may
 *   not be known precisely by the player; however, it MAY be estimated based
 *   upon playlist/manifest declarations. If the playlist declares both peak and
 *   average bitrate values, the peak value should be transmitted.
 *
 * @property {number} d
 *   The playback duration in milliseconds of the object being requested. If a
 *   partial segment is being requested, then this value MUST indicate the
 *   playback duration of that part and not that of its parent segment. This
 *   value can be an approximation of the estimated duration if the explicit
 *   value is not known.
 *
 * @property {shaka.util.CmcdManager.ObjectType} ot
 *   The media type of the current object being requested:
 *   - `m` = text file, such as a manifest or playlist
 *   - `a` = audio only
 *   - `v` = video only
 *   - `av` = muxed audio and video
 *   - `i` = init segment
 *   - `c` = caption or subtitle
 *   - `tt` = ISOBMFF timed text track
 *   - `k` = cryptographic key, license or certificate.
 *   - `o` = other
 *
 *   If the object type being requested is unknown, then this key MUST NOT be
 *   used.
 *
 * @property {number} tb
 *   The highest bitrate rendition in the manifest or playlist that the client
 *   is allowed to play, given current codec, licensing and sizing constraints.
 *
 * @property {number} bl
 *   The buffer length associated with the media object being requested. This
 *   value MUST be rounded to the nearest 100 ms. This key SHOULD only be sent
 *   with an object type of ‘a’, ‘v’ or ‘av’.
 *
 * @property {number} dl
 *   Deadline from the request time until the first sample of this
 *   Segment/Object needs to be available in order to not create a buffer
 *   underrun or any other playback problems. This value MUST be rounded to the
 *   nearest 100ms. For a playback rate of 1, this may be equivalent to the
 *   player’s remaining buffer length.
 *
 * @property {number} mtp
 *   The throughput between client and server, as measured by the client and
 *   MUST be rounded to the nearest 100 kbps. This value, however derived,
 *   SHOULD be the value that the client is using to make its next Adaptive
 *   Bitrate switching decision. If the client is connected to multiple
 *   servers concurrently, it must take care to report only the throughput
 *   measured against the receiving server. If the client has multiple
 *   concurrent connections to the server, then the intent is that this value
 *   communicates the aggregate throughput the client sees across all those
 *   connections.
 *
 * @property {string} nor
 *   Relative path of the next object to be requested. This can be used to
 *   trigger pre-fetching by the CDN. This MUST be a path relative to the
 *   current request. This string MUST be URLEncoded. The client SHOULD NOT
 *   depend upon any pre-fetch action being taken - it is merely a request for
 *   such a pre-fetch to take place.
 *
 * @property {string} nrr
 *   If the next request will be a partial object request, then this string
 *   denotes the byte range to be requested. If the ‘nor’ field is not set, then
 *   the object is assumed to match the object currently being requested. The
 *   client SHOULD NOT depend upon any pre-fetch action being taken – it is
 *   merely a request for such a pre-fetch to take place. Formatting is similar
 *   to the HTTP Range header, except that the unit MUST be ‘byte’, the ‘Range:’
 *   prefix is NOT required and specifying multiple ranges is NOT allowed. Valid
 *   combinations are:
 *
 *   - `"\<range-start\>-"`
 *   - `"\<range-start\>-\<range-end\>"`
 *   - `"-\<suffix-length\>"`
 *
 * @property {boolean} su
 *   Key is included without a value if the object is needed urgently due to
 *   startup, seeking or recovery after a buffer-empty event. The media SHOULD
 *   not be rendering when this request is made. This key MUST not be sent if it
 *   is FALSE.
 *
 * @property {string} cid
 *   A unique string identifying the current content. Maximum length is 64
 *   characters. This value is consistent across multiple different sessions and
 *   devices and is defined and updated at the discretion of the service
 *   provider.
 *
 * @property {number} pr
 *   The playback rate. `1` if real-time, `2` if double speed, `0` if not
 *   playing. SHOULD only be sent if not equal to `1`.
 *
 * @property {shaka.util.CmcdManager.StreamingFormat} sf
 *   The streaming format that defines the current request.
 *
 *   - `d` = MPEG DASH
 *   - `h` = HTTP Live Streaming (HLS)
 *   - `s` = Smooth Streaming
 *   - `o` = other
 *
 *   If the streaming format being requested is unknown, then this key MUST NOT
 *   be used.
 *
 * @property {string} sid
 *   A GUID identifying the current playback session. A playback session
 *   typically ties together segments belonging to a single media asset. Maximum
 *   length is 64 characters. It is RECOMMENDED to conform to the UUID
 *   specification.
 *
 * @property {shaka.util.CmcdManager.StreamType} st
 *   Stream type
 *   - `v` = all segments are available – e.g., VOD
 *   - `l` = segments become available over time – e.g., LIVE
 *
 * @property {number} v
 *   The version of this specification used for interpreting the defined key
 *   names and values. If this key is omitted, the client and server MUST
 *   interpret the values as being defined by version 1. Client SHOULD omit this
 *   field if the version is 1.
 *
 * @property {boolean} bs
 *   Buffer starvation key is included without a value if the buffer was starved
 *   at some point between the prior request and this object request, resulting
 *   in the player being in a rebuffering state and the video or audio playback
 *   being stalled. This key MUST NOT be sent if the buffer was not starved
 *   since the prior request.
 *
 *   If the object type `ot` key is sent along with this key, then the `bs` key
 *   refers to the buffer associated with the particular object type. If no
 *   object type is communicated, then the buffer state applies to the current
 *   session.
 *
 * @property {number} rtp
 *   Requested maximum throughput
 *
 *   The requested maximum throughput that the client considers sufficient for
 *   delivery of the asset. Values MUST be rounded to the nearest 100kbps. For
 *   example, a client would indicate that the current segment, encoded at
 *   2Mbps, is to be delivered at no more than 10Mbps, by using rtp=10000.
 *
 *   Note: This can benefit clients by preventing buffer saturation through
 *   over-delivery and can also deliver a community benefit through fair-share
 *   delivery. The concept is that each client receives the throughput necessary
 *   for great performance, but no more. The CDN may not support the rtp
 *   feature.
 */
shaka.util.CmcdManager.Data;


/**
 * @enum {string}
 */
shaka.util.CmcdManager.ObjectType = {
  MANIFEST: 'm',
  AUDIO: 'a',
  VIDEO: 'v',
  MUXED: 'av',
  INIT: 'i',
  CAPTION: 'c',
  TIMED_TEXT: 'tt',
  KEY: 'k',
  OTHER: 'o',
};


/**
 * @enum {string}
 */
shaka.util.CmcdManager.StreamType = {
  VOD: 'v',
  LIVE: 'l',
};


/**
 * @enum {string}
 * @export
 */
shaka.util.CmcdManager.StreamingFormat = {
  DASH: 'd',
  HLS: 'h',
  SMOOTH: 's',
  OTHER: 'o',
};


/**
 * The CMCD spec version
 * @const {number}
 */
shaka.util.CmcdManager.Version = 1;
