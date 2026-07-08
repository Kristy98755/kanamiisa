async function collectAllClientInfo() {
  const info = {};

  // ============================================================
  // 1. NAVIGATOR PROPERTIES
  // ============================================================
  try {
    info.navigator = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      vendor: navigator.vendor,
      appName: navigator.appName,
      appVersion: navigator.appVersion,
      appCodeName: navigator.appCodeName,
      product: navigator.product,
      productSub: navigator.productSub,
      language: navigator.language,
      languages: navigator.languages ? [...navigator.languages] : undefined,
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      onLine: navigator.onLine,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints,
      webdriver: navigator.webdriver,
      pdfViewerEnabled: navigator.pdfViewerEnabled,
      oscpu: navigator.oscpu,
      buildID: navigator.buildID,
      isProtocolHandlerRegistered: typeof navigator.isProtocolHandlerRegistered === 'function',
      canShare: typeof navigator.share === 'function',
      contacts: typeof navigator.contacts !== 'undefined',
      credentials: typeof navigator.credentials !== 'undefined',
      xr: typeof navigator.xr !== 'undefined',
      serial: typeof navigator.serial !== 'undefined',
      usb: typeof navigator.usb !== 'undefined',
      hid: typeof navigator.hid !== 'undefined',
      bluetooth: typeof navigator.bluetooth !== 'undefined',
      gamepads: typeof navigator.getGamepads === 'function',
      mediaDevices: typeof navigator.mediaDevices !== 'undefined',
      serviceWorker: typeof navigator.serviceWorker !== 'undefined',
      clipboard: typeof navigator.clipboard !== 'undefined',
      permissions: typeof navigator.permissions !== 'undefined',
      scheduling: typeof navigator.scheduling !== 'undefined',
      storage: typeof navigator.storage !== 'undefined',
      presentation: typeof navigator.presentation !== 'undefined',
      globalPrivacyControl: navigator.globalPrivacyControl,
      connection: navigator.connection ? {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData,
        type: navigator.connection.type,
        downlinkMax: navigator.connection.downlinkMax,
        networkType: navigator.connection.networkType,
      } : undefined,
      userAgentData: navigator.userAgentData ? {
        brands: navigator.userAgentData.brands,
        mobile: navigator.userAgentData.mobile,
        platform: navigator.userAgentData.platform,
      } : undefined,
      propertyCount: Object.keys(navigator).length,
    };
  } catch (e) { info.navigator = { error: e.message }; }

  // High-entropy Client Hints (async)
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      navigator.userAgentData.getHighEntropyValues([
        'architecture', 'bitness', 'formFactors', 'fullVersionList',
        'model', 'platformVersion', 'uaFullVersion', 'wow64'
      ]).then(values => {
        info.navigator.userAgentDataHighEntropy = values;
      }).catch(() => {});
    }
  } catch (e) {}

  // ============================================================
  // 2. SCREEN / WINDOW
  // ============================================================
  try {
    info.screen = {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      orientation: screen.orientation ? {
        type: screen.orientation.type,
        angle: screen.orientation.angle,
      } : undefined,
    };
  } catch (e) { info.screen = { error: e.message }; }

  try {
    info.window = {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      screenWidth: window.screen?.width,
      screenHeight: window.screen?.height,
      screenAvailWidth: window.screen?.availWidth,
      screenAvailHeight: window.screen?.availHeight,
      screenColorDepth: window.screen?.colorDepth,
      screenPixelDepth: window.screen?.pixelDepth,
      screenLeft: window.screenLeft,
      screenTop: window.screenTop,
      visualViewport: window.visualViewport ? {
        width: window.visualViewport.width,
        height: window.visualViewport.height,
        offsetLeft: window.visualViewport.offsetLeft,
        offsetTop: window.visualViewport.offsetTop,
        pageLeft: window.visualViewport.pageLeft,
        pageTop: window.visualViewport.pageTop,
        scale: window.visualViewport.scale,
      } : undefined,
      chromeBarHeight: window.outerHeight - window.innerHeight,
      chromeBarWidth: window.outerWidth - window.innerWidth,
      isSecureContext: window.isSecureContext,
      crossOriginIsolated: window.crossOriginIsolated,
    };
  } catch (e) { info.window = { error: e.message }; }

  // ============================================================
  // 3. WEBGL / WEBGPU
  // ============================================================
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      info.webgl = {
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxCubeMapTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
        maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
        maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
        maxVertexTextureImageUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
        maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS),
        maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
        maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
        aliasedLineWidthRange: gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE),
        aliasedPointSizeRange: gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE),
        maxAnisotropy: gl.getExtension('EXT_texture_filter_anisotropic')
          ? gl.getParameter(gl.MAX_MAX_ANISOTROPY_EXT) : null,
        extensions: gl.getSupportedExtensions(),
        shaderPrecisionFormats: (() => {
          try {
            const types = ['VERTEX_SHADER', 'FRAGMENT_SHADER'];
            const precisions = ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT', 'LOW_INT', 'MEDIUM_INT', 'HIGH_INT'];
            const result = {};
            for (const type of types) {
              result[type] = {};
              for (const precision of precisions) {
                try {
                  const fmt = gl.getShaderPrecisionFormat(gl[type], gl[precision]);
                  result[type][precision] = { rangeMin: fmt.rangeMin, rangeMax: fmt.rangeMax, precision: fmt.precision };
                } catch (e) {}
              }
            }
            return result;
          } catch (e) { return null; }
        })(),
        maxSamples: gl.getParameter(gl.MAX_SAMPLES),
        subpixelBits: gl.getParameter(gl.SUBPIXEL_BITS),
        redBits: gl.getParameter(gl.RED_BITS),
        greenBits: gl.getParameter(gl.GREEN_BITS),
        blueBits: gl.getParameter(gl.BLUE_BITS),
        alphaBits: gl.getParameter(gl.ALPHA_BITS),
        depthBits: gl.getParameter(gl.DEPTH_BITS),
        stencilBits: gl.getParameter(gl.STENCIL_BITS),
        antialias: gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE),
        sampleBuffers: gl.getParameter(gl.SAMPLE_BUFFERS),
        samples: gl.getParameter(gl.SAMPLES),
      };
    } else {
      info.webgl = { supported: false };
    }
  } catch (e) { info.webgl = { error: e.message }; }

  // WebGPU
  try {
    if (navigator.gpu) {
      navigator.gpu.requestAdapter().then(adapter => {
        if (adapter) {
          info.webgpu = {
            supported: true,
            vendor: adapter.vendor,
            architecture: adapter.architecture,
            device: adapter.device,
            description: adapter.description,
            limits: adapter.limits ? {
              maxTextureDimension1D: adapter.limits.maxTextureDimension1D,
              maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
              maxTextureDimension3D: adapter.limits.maxTextureDimension3D,
              maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
              maxBufferSize: adapter.limits.maxBufferSize,
              maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
              maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
              maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
              maxTextureSamples: adapter.limits.maxTextureSamples,
            } : null,
            features: adapter.features ? [...adapter.features] : [],
          };
        }
      }).catch(() => {});
    }
  } catch (e) {}

  // ============================================================
  // 4. CANVAS FINGERPRINTING
  // ============================================================
  try {
    const fpCanvas = document.createElement('canvas');
    fpCanvas.width = 280;
    fpCanvas.height = 60;
    const fpCtx = fpCanvas.getContext('2d');
    fpCtx.textBaseline = 'top';
    fpCtx.font = '14px Arial';
    fpCtx.fillStyle = '#f60';
    fpCtx.fillRect(125, 1, 62, 20);
    fpCtx.fillStyle = '#069';
    fpCtx.fillText('BrowserFingerprint \u2764 \u2665', 2, 15);
    fpCtx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    fpCtx.fillText('BrowserFingerprint \u2764 \u2665', 4, 17);
    const canvasData = fpCanvas.toDataURL();
    info.canvas = {
      dataUrl: canvasData,
      dataLength: canvasData.length,
    };
  } catch (e) { info.canvas = { error: e.message }; }

  // Canvas with emoji rendering
  try {
    const emojiCanvas = document.createElement('canvas');
    emojiCanvas.width = 100;
    emojiCanvas.height = 50;
    const emojiCtx = emojiCanvas.getContext('2d');
    emojiCtx.font = '20px serif';
    emojiCtx.fillText('\u{1F600}', 0, 30);
    info.canvas.emoji = emojiCanvas.toDataURL().length;
  } catch (e) {}

  // ============================================================
  // 5. AUDIO FINGERPRINTING
  // ============================================================
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      info.audio = {
        available: true,
        baseLatency: null,
        outputLatency: null,
        maxChannelCount: null,
        sampleRate: null,
      };
      try {
        const testCtx = new AudioCtx();
        info.audio.baseLatency = testCtx.baseLatency;
        info.audio.outputLatency = testCtx.outputLatency;
        testCtx.close();
      } catch (e) {}
    } else {
      info.audio = { available: false };
    }
  } catch (e) { info.audio = { error: e.message }; }

  // OfflineAudioContext fingerprint
  try {
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (OfflineCtx) {
      const ctx = new OfflineCtx(1, 44100, 44100);
      const osc = ctx.createOscillator();
      const comp = ctx.createDynamicsCompressor();
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      ctx.startRendering().then(buffer => {
        const data = buffer.getChannelData(0);
        const samples = [];
        for (let i = 0; i < 1000; i++) {
          samples.push(Math.round(data[i] * 100000) / 100000);
        }
        info.audio.offlineFingerprint = samples;
        info.audio.bufferLength = data.length;
        info.audio.numberofChannels = buffer.numberOfChannels;
        info.audio.sampleRate = buffer.sampleRate;
        info.audio.duration = buffer.duration;
      }).catch(() => {});
    }
  } catch (e) {}

  // ============================================================
  // 6. NETWORK INFO
  // ============================================================
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      info.network = {
        effectiveType: conn.effectiveType,
        downlink: conn.downlink,
        rtt: conn.rtt,
        saveData: conn.saveData,
        type: conn.type,
        downlinkMax: conn.downlinkMax,
        networkType: conn.networkType,
        events: typeof conn.addEventListener === 'function',
      };
    } else {
      info.network = { available: false };
    }
  } catch (e) { info.network = { error: e.message }; }

  // ============================================================
  // 7. BATTERY
  // ============================================================
  try {
    if (navigator.getBattery) {
      navigator.getBattery().then(battery => {
        info.battery = {
          level: battery.level,
          charging: battery.charging,
          chargingTime: battery.chargingTime,
          dischargingTime: battery.dischargingTime,
          addEventListener: typeof battery.addEventListener === 'function',
        };
      }).catch(() => { info.battery = { available: false }; });
    } else {
      info.battery = { available: false };
    }
  } catch (e) { info.battery = { error: e.message }; }

  // ============================================================
  // 8. MEMORY
  // ============================================================
  try {
    info.memory = {
      deviceMemory: navigator.deviceMemory,
    };
  } catch (e) { info.memory = { error: e.message }; }

  try {
    if (performance.memory) {
      info.memory.jsHeapSizeLimit = performance.memory.jsHeapSizeLimit;
      info.memory.totalJSHeapSize = performance.memory.totalJSHeapSize;
      info.memory.usedJSHeapSize = performance.memory.usedJSHeapSize;
    }
  } catch (e) {}

  // ============================================================
  // 9. CPU
  // ============================================================
  try {
    info.cpu = {
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
  } catch (e) { info.cpu = { error: e.message }; }

  // Clock skew via performance.now()
  try {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {}
    const t1 = performance.now();
    info.cpu.clockSkew = t1 - t0;
    info.cpu.performanceNowPrecision = (() => {
      const vals = [];
      for (let i = 0; i < 10; i++) {
        vals.push(performance.now() % 1);
      }
      return vals;
    })();
  } catch (e) {}

  // ============================================================
  // 10. STORAGE
  // ============================================================
  try {
    info.storage = {
      localStorage: typeof localStorage !== 'undefined',
      sessionStorage: typeof sessionStorage !== 'undefined',
      indexedDB: typeof indexedDB !== 'undefined',
      openDatabase: typeof openDatabase === 'function',
      cookieEnabled: navigator.cookieEnabled,
    };
  } catch (e) { info.storage = { error: e.message }; }

  try {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(est => {
        info.storage.estimate = {
          quota: est.quota,
          usage: est.usage,
        };
      }).catch(() => {});
    }
  } catch (e) {}

  try {
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(persisted => {
        info.storage.persisted = persisted;
      }).catch(() => {});
    }
  } catch (e) {}

  try {
    if (navigator.storage && navigator.storage.getDirectory) {
      info.storage.fileSystemAccess = true;
    }
  } catch (e) {}

  // ============================================================
  // 11. MEDIA
  // ============================================================
  try {
    info.media = {};
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        info.media = {
          deviceCount: devices.length,
          audioInputCount: devices.filter(d => d.kind === 'audioinput').length,
          audioOutputCount: devices.filter(d => d.kind === 'audiooutput').length,
          videoInputCount: devices.filter(d => d.kind === 'videoinput').length,
          devices: devices.map(d => ({
            kind: d.kind,
            label: d.label || '(no label)',
            deviceId: d.deviceId,
            groupId: d.groupId,
          })),
        };
      }).catch(() => { info.media = { available: false }; });
    } else {
      info.media = { available: false };
    }
  } catch (e) { info.media = { error: e.message }; }

  // Media Capabilities
  try {
    if (navigator.mediaCapabilities) {
      const codecs = [
        'video/webm;codecs=vp8', 'video/webm;codecs=vp9',
        'video/webm;codecs=av1', 'video/mp4;codecs=h264',
        'video/mp4;codecs=hevc', 'video/ogg;codecs=theora',
        'audio/webm;codecs=opus', 'audio/ogg;codecs=opus',
        'audio/mp3', 'audio/aac',
      ];
      const results = {};
      const check = async (codec) => {
        try {
          const isVideo = codec.startsWith('video');
          const config = isVideo
            ? { type: 'media-source', video: { contentType: codec, width: 1920, height: 1080, bitrate: 5000000, framerate: 30 } }
            : { type: 'media-source', audio: { contentType: codec, channels: 2, bitrate: 128000, sampleRate: 44100 } };
          const res = await navigator.mediaCapabilities.decodingInfo(config);
          return { supported: res.supported, smooth: res.smooth, powerEfficient: res.powerEfficient };
        } catch (e) { return { error: e.message }; }
      };
      Promise.all(codecs.map(c => check(c).then(r => { results[c] = r; }))).then(() => {
        info.media.capabilities = results;
      });
    }
  } catch (e) {}

  // ============================================================
  // 12. FONTS
  // ============================================================
  try {
    const testFonts = [
      'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 'Cambria Math',
      'Comic Sans MS', 'Consolas', 'Courier', 'Courier New', 'Georgia', 'Helvetica',
      'Helvetica Neue', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
      'Microsoft Sans Serif', 'Monaco', 'Palatino Linotype', 'Segoe UI',
      'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Wingdings',
      'Ubuntu', 'Ubuntu Mono', 'Roboto', 'Roboto Mono', 'Open Sans', 'Lato',
      'Montserrat', 'Source Sans Pro', 'Noto Sans', 'Droid Sans',
      'DejaVu Sans', 'Fira Sans', 'Inconsolata', 'PT Sans', 'Raleway',
      'Cantarell', 'Liberation Sans', 'Liberation Mono', 'Noto Serif',
      'Ubuntu Light', 'Crimson Text', 'Merriweather', 'PT Serif',
      'Droid Serif', 'Hack', 'Space Mono', 'JetBrains Mono', 'Fira Code',
      'SF Pro Display', 'SF Pro Text', 'PingFang SC', 'PingFang HK',
      'Hiragino Sans', 'Meiryo', 'Yu Gothic', 'MS Gothic', 'MS Mincho',
      'SimSun', 'SimHei', 'MingLiU', 'DFKai-SB', 'AR PL UMing CN',
      'WenQuanYi Micro Hei', 'Noto Sans CJK SC', 'Noto Sans CJK TC',
      'Noto Sans CJK JP', 'Noto Sans CJK KR',
    ];
    const baseFonts = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'];
    const testString = 'mmmmmmmmmmlli';
    const testSize = '72px';
    const span = document.createElement('span');
    span.style.cssText = 'position:absolute;left:-9999px;font-size:' + testSize + ';visibility:hidden';
    span.textContent = testString;
    document.body.appendChild(span);
    const baseWidths = {};
    baseFonts.forEach(font => {
      span.style.fontFamily = "'" + font + "'";
      baseWidths[font] = span.getBoundingClientRect().width;
    });
    const detected = [];
    testFonts.forEach(font => {
      let found = false;
      baseFonts.forEach(base => {
        if (found) return;
        span.style.fontFamily = "'" + font + "', " + base;
        const width = span.getBoundingClientRect().width;
        if (width !== baseWidths[base]) { found = true; detected.push(font); }
      });
    });
    document.body.removeChild(span);
    info.fonts = {
      detected: detected,
      count: detected.length,
      list: detected.join('|'),
    };
  } catch (e) { info.fonts = { error: e.message }; }

  // ============================================================
  // 13. CSS MEDIA QUERIES
  // ============================================================
  try {
    const mqTest = (query) => {
      try {
        return window.matchMedia(query).matches;
      } catch (e) { return null; }
    };
    info.css = {
      prefersColorScheme: mqTest('(prefers-color-scheme: dark)') ? 'dark' : mqTest('(prefers-color-scheme: light)') ? 'light' : 'no-preference',
      prefersReducedMotion: mqTest('(prefers-reduced-motion: reduce)'),
      prefersReducedTransparency: mqTest('(prefers-reduced-transparency: reduce)'),
      prefersContrast: mqTest('(prefers-contrast: high)') ? 'high' : mqTest('(prefers-contrast: low)') ? 'low' : mqTest('(prefers-contrast: more)') ? 'more' : mqTest('(prefers-contrast: less)') ? 'less' : 'no-preference',
      forcedColors: mqTest('(forced-colors: active)'),
      forcedColorsMode: mqTest('(forced-colors: none)') ? 'none' : mqTest('(forced-colors: active)') ? 'active' : 'null',
      invertedColors: mqTest('(inverted-colors: inverted)'),
      colorGamut: mqTest('(color-gamut: rec2020)') ? 'rec2020' : mqTest('(color-gamut: p3)') ? 'p3' : mqTest('(color-gamut: srgb)') ? 'srgb' : 'undefined',
      colorScheme: mqTest('(color-scheme: dark)') ? 'dark' : 'light',
      dynamicRange: mqTest('(dynamic-range: high)') ? 'high' : 'standard',
      hdr: mqTest('(dynamic-range: high)'),
      hover: mqTest('(hover: hover)') ? 'hover' : mqTest('(hover: none)') ? 'none' : 'undefined',
      anyHover: mqTest('(any-hover: hover)') ? 'hover' : mqTest('(any-hover: none)') ? 'none' : 'undefined',
      pointer: mqTest('(pointer: fine)') ? 'fine' : mqTest('(pointer: coarse)') ? 'coarse' : 'none',
      anyPointer: mqTest('(any-pointer: fine)') ? 'fine' : mqTest('(any-pointer: coarse)') ? 'coarse' : mqTest('(any-pointer: none)') ? 'none' : 'undefined',
      updateFrequency: mqTest('(update: fast)') ? 'fast' : mqTest('(update: slow)') ? 'slow' : 'none',
      overflowBlock: mqTest('(overflow-block: scroll)') ? 'scroll' : mqTest('(overflow-block: paged)') ? 'paged' : 'none',
      displayMode: mqTest('(display-mode: standalone)') ? 'standalone' : mqTest('(display-mode: fullscreen)') ? 'fullscreen' : mqTest('(display-mode: minimal-ui)') ? 'minimal-ui' : 'browser',
      displayModeBrowser: mqTest('(display-mode: browser)'),
      scripting: mqTest('(scripting: enabled)') ? 'enabled' : mqTest('(scripting: none)') ? 'none' : 'initial-only',
      monochrome: mqTest('(monochrome)') ? parseInt(window.matchMedia('(monochrome)').media.match(/\d+/)?.[0] || '0') : 0,
      inverted: mqTest('(inverted-colors)'),
      prefersReducedData: mqTest('(prefers-reduced-data: reduce)'),
      viewportSegmentWidth: mqTest('(viewport-segment-width: 100)'),
      screenReader: mqTest('(screen-reader)'),
    };
  } catch (e) { info.css = { error: e.message }; }

  // ============================================================
  // 14. KEYBOARD LAYOUT DETECTION
  // ============================================================
  try {
    info.keyboard = {
      getLayoutMap: typeof navigator.keyboard !== 'undefined' && typeof navigator.keyboard.getLayoutMap === 'function',
    };
    if (info.keyboard.getLayoutMap) {
      navigator.keyboard.getLayoutMap().then(layout => {
        info.keyboard.layout = {};
        layout.forEach((value, key) => {
          info.keyboard.layout[key] = value;
        });
        info.keyboard.layoutKeyCount = Object.keys(info.keyboard.layout).length;
      }).catch(() => {});
    }
  } catch (e) { info.keyboard = { error: e.message }; }

  // KeyboardEvent.code detection
  try {
    info.keyboard.code = typeof KeyboardEvent.prototype.code !== 'undefined';
  } catch (e) {}

  // ============================================================
  // 15. TOUCH / POINTER
  // ============================================================
  try {
    info.touch = {
      maxTouchPoints: navigator.maxTouchPoints,
      touchEvent: typeof TouchEvent !== 'undefined',
      touchPoints: 'ontouchstart' in window ? navigator.maxTouchPoints : 0,
      pointerEvent: typeof PointerEvent !== 'undefined',
      msMaxTouchPoints: navigator.msMaxTouchPoints,
    };
  } catch (e) { info.touch = { error: e.message }; }

  // ============================================================
  // 16. PERMISSIONS
  // ============================================================
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const permissionNames = [
        'geolocation', 'notifications', 'push', 'midi',
        'camera', 'microphone', 'accelerometer', 'gyroscope',
        'magnetometer', 'clipboard-read', 'clipboard-write',
        'persistent-storage', 'ambient-light-sensor',
        'background-sync', 'background-fetch',
        'payment-handler', 'periodic-background-sync',
        'screen-wake-lock', 'nfc',
        'storage-access', 'local-fonts',
        'file-system-access', 'window-management',
      ];
      info.permissions = {};
      permissionNames.forEach(name => {
        navigator.permissions.query({ name }).then(result => {
          info.permissions[name] = result.state;
        }).catch(() => {
          info.permissions[name] = 'unavailable';
        });
      });
    } else {
      info.permissions = { available: false };
    }
  } catch (e) { info.permissions = { error: e.message }; }

  // ============================================================
  // 17. SERVICE WORKERS
  // ============================================================
  try {
    info.serviceWorker = {
      supported: 'serviceWorker' in navigator,
      controller: navigator.serviceWorker?.controller !== null,
      ready: typeof navigator.serviceWorker?.ready !== 'undefined',
    };
  } catch (e) { info.serviceWorker = { error: e.message }; }

  // ============================================================
  // 18. HISTORY
  // ============================================================
  try {
    info.history = {
      length: history.length,
    };
  } catch (e) { info.history = { error: e.message }; }

  // ============================================================
  // 19. PERFORMANCE
  // ============================================================
  try {
    info.performance = {
      timeOrigin: performance.timeOrigin,
      now: performance.now(),
      timing: performance.timing ? {
        navigationStart: performance.timing.navigationStart,
        unloadEventStart: performance.timing.unloadEventStart,
        unloadEventEnd: performance.timing.unloadEventEnd,
        redirectStart: performance.timing.redirectStart,
        redirectEnd: performance.timing.redirectEnd,
        fetchStart: performance.timing.fetchStart,
        domainLookupStart: performance.timing.domainLookupStart,
        domainLookupEnd: performance.timing.domainLookupEnd,
        connectStart: performance.timing.connectStart,
        connectEnd: performance.timing.connectEnd,
        secureConnectionStart: performance.timing.secureConnectionStart,
        requestStart: performance.timing.requestStart,
        responseStart: performance.timing.responseStart,
        responseEnd: performance.timing.responseEnd,
        domLoading: performance.timing.domLoading,
        domInteractive: performance.timing.domInteractive,
        domContentLoadedEventStart: performance.timing.domContentLoadedEventStart,
        domContentLoadedEventEnd: performance.timing.domContentLoadedEventEnd,
        domComplete: performance.timing.domComplete,
        loadEventStart: performance.timing.loadEventStart,
        loadEventEnd: performance.timing.loadEventEnd,
      } : null,
      navigation: performance.navigation ? {
        type: performance.navigation.type,
        redirectCount: performance.navigation.redirectCount,
      } : null,
      memory: performance.memory ? {
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        usedJSHeapSize: performance.memory.usedJSHeapSize,
      } : null,
      eventCounts: performance.getEntriesByType ? performance.getEntriesByType('event')?.length : null,
      resourceCount: performance.getEntriesByType ? performance.getEntriesByType('resource')?.length : null,
      paint: performance.getEntriesByType ? performance.getEntriesByType('paint') : null,
    };
  } catch (e) { info.performance = { error: e.message }; }

  // ============================================================
  // 20. INTL
  // ============================================================
  try {
    const dtf = new Intl.DateTimeFormat();
    const resolvedOptions = dtf.resolvedOptions();
    info.intl = {
      locale: resolvedOptions.locale,
      calendar: resolvedOptions.calendar,
      numberingSystem: resolvedOptions.numberingSystem,
      timeZone: resolvedOptions.timeZone,
      hourCycle: resolvedOptions.hourCycle,
      dayPeriod: resolvedOptions.dayPeriod,
      dateStyle: resolvedOptions.dateStyle,
      timeStyle: resolvedOptions.timeStyle,
      fractionalSecondDigits: resolvedOptions.fractionalSecondDigits,
    };
  } catch (e) { info.intl = { error: e.message }; }

  try {
    const nfmt = new Intl.NumberFormat();
    const nResolved = nfmt.resolvedOptions();
    info.intl.numberFormat = {
      locale: nResolved.locale,
      numberingSystem: nResolved.numberingSystem,
      currency: nResolved.currency,
      currencyDisplay: nResolved.currencyDisplay,
      currencySign: nResolved.currencySign,
      compactDisplay: nResolved.compactDisplay,
      notation: nResolved.notation,
      signDisplay: nResolved.signDisplay,
      unit: nResolved.unit,
      unitDisplay: nResolved.unitDisplay,
    };
  } catch (e) {}

  try {
    const ltf = new Intl.ListFormat();
    info.intl.listFormat = {
      locale: ltf.resolvedOptions().locale,
      style: ltf.resolvedOptions().style,
      type: ltf.resolvedOptions().type,
    };
  } catch (e) {}

  try {
    const rtf = new Intl.RelativeTimeFormat();
    info.intl.relativeTimeFormat = {
      locale: rtf.resolvedOptions().locale,
      numeric: rtf.resolvedOptions().numeric,
      style: rtf.resolvedOptions().style,
    };
  } catch (e) {}

  try {
    const ptf = new Intl.PluralRules();
    info.intl.pluralRules = {
      locale: ptf.resolvedOptions().locale,
      type: ptf.resolvedOptions().type,
    };
  } catch (e) {}

  try {
    const ctf = new Intl.Collator();
    info.intl.collator = {
      locale: ctf.resolvedOptions().locale,
      usage: ctf.resolvedOptions().usage,
      sensitivity: ctf.resolvedOptions().sensitivity,
      ignorePunctuation: ctf.resolvedOptions().ignorePunctuation,
      numeric: ctf.resolvedOptions().numeric,
      caseFirst: ctf.resolvedOptions().caseFirst,
    };
  } catch (e) {}

  try {
    if (Intl.Segmenter) {
      const seg = new Intl.Segmenter();
      info.intl.segmenter = {
        locale: seg.resolvedOptions().locale,
        granularity: seg.resolvedOptions().granularity,
      };
    }
  } catch (e) {}

  try {
    if (Intl.supportedValuesOf) {
      info.intl.supportedCalendars = Intl.supportedValuesOf('calendar');
      info.intl.supportedNumberingSystems = Intl.supportedValuesOf('numberingSystem');
      info.intl.supportedTimeZones = Intl.supportedValuesOf('timeZone');
      info.intl.supportedLocales = Intl.supportedValuesOf('locale');
    }
  } catch (e) {}

  // ============================================================
  // 21. DATE / TIME
  // ============================================================
  try {
    const now = new Date();
    info.datetime = {
      timezoneOffset: now.getTimezoneOffset(),
      timezoneName: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
      dateString: now.toLocaleDateString(),
      timeString: now.toLocaleTimeString(),
      isoString: now.toISOString(),
      timestamp: now.getTime(),
      year: now.getFullYear(),
      month: now.getMonth(),
      day: now.getDate(),
      hours: now.getHours(),
      minutes: now.getMinutes(),
      seconds: now.getSeconds(),
      milliseconds: now.getMilliseconds(),
      dayOfWeek: now.getDay(),
      dayOfYear: Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000),
      weekOfYear: (() => {
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const daysDiff = Math.floor((now - startOfYear) / 86400000);
        return Math.ceil((daysDiff + startOfYear.getDay() + 1) / 7);
      })(),
    };
  } catch (e) { info.datetime = { error: e.message }; }

  // ============================================================
  // 22. PLUGINS
  // ============================================================
  try {
    info.plugins = {
      count: navigator.plugins?.length || 0,
      names: navigator.plugins ? [...Array.from(navigator.plugins).map(p => p.name)] : [],
      descriptions: navigator.plugins ? [...Array.from(navigator.plugins).map(p => p.description)] : [],
      filenames: navigator.plugins ? [...Array.from(navigator.plugins).map(p => p.filename)] : [],
      mimeTypes: navigator.mimeTypes ? [...Array.from(navigator.mimeTypes).map(m => m.type)] : [],
      pdfViewerEnabled: navigator.pdfViewerEnabled,
    };
  } catch (e) { info.plugins = { error: e.message }; }

  // ============================================================
  // 23. WEBRTC
  // ============================================================
  try {
    info.webrtc = {
      supported: typeof RTCPeerConnection !== 'undefined',
      rtcPeerConnection: typeof RTCPeerConnection !== 'undefined',
      webkitRTCPeerConnection: typeof webkitRTCPeerConnection !== 'undefined',
      mozRTCPeerConnection: typeof mozRTCPeerConnection !== 'undefined',
    };
  } catch (e) { info.webrtc = { error: e.message }; }

  // ============================================================
  // 24. WEB WORKERS
  // ============================================================
  try {
    info.workers = {
      worker: typeof Worker !== 'undefined',
      sharedWorker: typeof SharedWorker !== 'undefined',
      serviceWorker: 'serviceWorker' in navigator,
      worklet: typeof AudioWorklet !== 'undefined' || typeof CSS_Houdini_worklet !== 'undefined',
    };
  } catch (e) { info.workers = { error: e.message }; }

  // ============================================================
  // 25. MANIFEST
  // ============================================================
  try {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    info.manifest = {
      available: !!manifestLink,
      href: manifestLink?.href || null,
    };
  } catch (e) { info.manifest = { error: e.message }; }

  // ============================================================
  // 26. PAYMENT REQUEST
  // ============================================================
  try {
    info.paymentRequest = {
      supported: typeof PaymentRequest !== 'undefined',
      canMakePayment: typeof PaymentRequest !== 'undefined'
        ? (async () => {
            try {
              const pr = new PaymentRequest([{ supportedMethods: 'basic-card' }], { total: { label: 'test', amount: { currency: 'USD', value: '0' } } });
              const result = await pr.canMakePayment();
              return result;
            } catch (e) { return null; }
          })()
        : null,
      applePay: typeof ApplePaySession !== 'undefined',
    };
  } catch (e) { info.paymentRequest = { error: e.message }; }

  // ============================================================
  // 27. CREDENTIAL MANAGEMENT
  // ============================================================
  try {
    info.credentialManagement = {
      credentials: typeof navigator.credentials !== 'undefined',
      publicKeyCredential: typeof PublicKeyCredential !== 'undefined',
      isUserVerifyingPlatformAuthenticatorAvailable: typeof PublicKeyCredential !== 'undefined'
        ? PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => null)
        : null,
      isConditionalMediationAvailable: typeof PublicKeyCredential !== 'undefined' && typeof PublicKeyCredential.isConditionalMediationAvailable === 'function'
        ? PublicKeyCredential.isConditionalMediationAvailable().catch(() => null)
        : null,
      federatedCredential: typeof FederatedCredential !== 'undefined',
      passwordCredential: typeof PasswordCredential !== 'undefined',
      digitalCredential: typeof DigitalCredential !== 'undefined',
    };
  } catch (e) { info.credentialManagement = { error: e.message }; }

  // ============================================================
  // 28. SPEECH SYNTHESIS
  // ============================================================
  try {
    info.speechSynthesis = {
      supported: typeof speechSynthesis !== 'undefined',
    };
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.onvoiceschanged = () => {
        const voices = speechSynthesis.getVoices();
        info.speechSynthesis.voices = voices.map(v => ({
          name: v.name,
          lang: v.lang,
          localService: v.localService,
          default: v.default,
          voiceURI: v.voiceURI,
        }));
        info.speechSynthesis.voiceCount = voices.length;
      };
      speechSynthesis.getVoices();
    }
  } catch (e) { info.speechSynthesis = { error: e.message }; }

  // ============================================================
  // 29. CLIPBOARD
  // ============================================================
  try {
    info.clipboard = {
      api: typeof navigator.clipboard !== 'undefined',
      clipboardItem: typeof ClipboardItem !== 'undefined',
      readText: typeof navigator.clipboard?.readText === 'function',
      writeText: typeof navigator.clipboard?.writeText === 'function',
      read: typeof navigator.clipboard?.read === 'function',
      write: typeof navigator.clipboard?.write === 'function',
    };
  } catch (e) { info.clipboard = { error: e.message }; }

  // ============================================================
  // 30. BLUETOOTH / USB / HID / SERIAL
  // ============================================================
  try {
    info.deviceAccess = {
      bluetooth: typeof navigator.bluetooth !== 'undefined',
      usb: typeof navigator.usb !== 'undefined',
      hid: typeof navigator.hid !== 'undefined',
      serial: typeof navigator.serial !== 'undefined',
      nfc: typeof navigator.nfc !== 'undefined' || typeof NDEFReader !== 'undefined',
      xrSystem: typeof navigator.xr !== 'undefined',
      wakeLock: typeof navigator.wakeLock !== 'undefined',
    };
  } catch (e) { info.deviceAccess = { error: e.message }; }

  // ============================================================
  // 31. GAMEPAD
  // ============================================================
  try {
    info.gamepad = {
      supported: typeof navigator.getGamepads === 'function',
      connected: navigator.getGamepads ? navigator.getGamepads().filter(g => g !== null).length : 0,
    };
  } catch (e) { info.gamepad = { error: e.message }; }

  // ============================================================
  // 32. XR / VR
  // ============================================================
  try {
    info.xr = {
      supported: typeof navigator.xr !== 'undefined',
      isSessionSupportedVR: typeof navigator.xr !== 'undefined'
        ? navigator.xr.isSessionSupported('immersive-vr').catch(() => null)
        : null,
      isSessionSupportedAR: typeof navigator.xr !== 'undefined'
        ? navigator.xr.isSessionSupported('immersive-ar').catch(() => null)
        : null,
      isSessionSupportedInline: typeof navigator.xr !== 'undefined'
        ? navigator.xr.isSessionSupported('inline').catch(() => null)
        : null,
    };
  } catch (e) { info.xr = { error: e.message }; }

  // ============================================================
  // 33. MEDIA SESSION
  // ============================================================
  try {
    info.mediaSession = {
      supported: 'mediaSession' in navigator,
      metadata: navigator.mediaSession?.metadata ? {
        title: navigator.mediaSession.metadata.title,
        artist: navigator.mediaSession.metadata.artist,
        album: navigator.mediaSession.metadata.album,
      } : null,
      playbackState: navigator.mediaSession?.playbackState || null,
      actionHandler: navigator.mediaSession?.setActionHandler ? true : false,
    };
  } catch (e) { info.mediaSession = { error: e.message }; }

  // ============================================================
  // 34. BARCODE DETECTION
  // ============================================================
  try {
    info.barcodeDetection = {
      supported: typeof BarcodeDetector !== 'undefined',
      formats: typeof BarcodeDetector !== 'undefined'
        ? BarcodeDetector.getSupportedFormats().catch(() => null)
        : null,
    };
  } catch (e) { info.barcodeDetection = { error: e.message }; }

  // ============================================================
  // 35. EYEDROPPER
  // ============================================================
  try {
    info.eyedropper = {
      supported: typeof EyeDropper !== 'undefined',
    };
  } catch (e) { info.eyedropper = { error: e.message }; }

  // ============================================================
  // 36. FILE SYSTEM ACCESS
  // ============================================================
  try {
    info.fileSystemAccess = {
      showOpenFilePicker: typeof showOpenFilePicker === 'function',
      showSaveFilePicker: typeof showSaveFilePicker === 'function',
      showDirectoryPicker: typeof showDirectoryPicker === 'function',
      getOriginPrivateDirectory: typeof navigator.storage?.getDirectory === 'function',
    };
  } catch (e) { info.fileSystemAccess = { error: e.message }; }

  // ============================================================
  // 37. IDLE DETECTION
  // ============================================================
  try {
    info.idleDetection = {
      supported: typeof IdleDetector !== 'undefined',
    };
  } catch (e) { info.idleDetection = { error: e.message }; }

  // ============================================================
  // 38. SCREEN WAKE LOCK
  // ============================================================
  try {
    info.wakeLock = {
      supported: typeof navigator.wakeLock !== 'undefined',
      sentinel: typeof WakeLockSentinel !== 'undefined',
    };
  } catch (e) { info.wakeLock = { error: e.message }; }

  // ============================================================
  // 39. BADGING
  // ============================================================
  try {
    info.badging = {
      setAppBadge: typeof navigator.setAppBadge === 'function',
      clearAppBadge: typeof navigator.clearAppBadge === 'function',
      setExperimentalAppBadge: typeof navigator.setExperimentalAppBadge === 'function',
    };
  } catch (e) { info.badging = { error: e.message }; }

  // ============================================================
  // 40. CONTACT PICKER
  // ============================================================
  try {
    info.contactPicker = {
      supported: typeof navigator.contacts !== 'undefined' && typeof navigator.contacts.select === 'function',
    };
  } catch (e) { info.contactPicker = { error: e.message }; }

  // ============================================================
  // 41. SERIAL / BLUETOOTH PORTS
  // ============================================================
  try {
    info.serialBluetooth = {
      serial: typeof navigator.serial !== 'undefined',
      serialRequestPort: typeof navigator.serial?.requestPort === 'function',
      bluetooth: typeof navigator.bluetooth !== 'undefined',
      bluetoothRequestDevice: typeof navigator.bluetooth?.requestDevice === 'function',
      bluetoothGetDevices: typeof navigator.bluetooth?.getDevices === 'function',
      usb: typeof navigator.usb !== 'undefined',
      usbRequestDevice: typeof navigator.usb?.requestDevice === 'function',
      hid: typeof navigator.hid !== 'undefined',
      hidRequestDevice: typeof navigator.hid?.requestDevice === 'function',
    };
  } catch (e) { info.serialBluetooth = { error: e.message }; }

  // ============================================================
  // BONUS: ADDITIONAL SIGNALS
  // ============================================================

  // Math precision fingerprinting
  try {
    info.math = {
      acos: Math.acos(0.5),
      acosh: typeof Math.acosh === 'function' ? Math.acosh(2) : null,
      asin: Math.asin(1),
      atan: Math.atan(1) * 2,
      cbrt: Math.cbrt(2),
      cosh: typeof Math.cosh === 'function' ? Math.cosh(1) : null,
      expm1: typeof Math.expm1 === 'function' ? Math.expm1(1) : null,
      log10: typeof Math.log10 === 'function' ? Math.log10(2) : null,
      log1p: typeof Math.log1p === 'function' ? Math.log1p(1) : null,
      log2: typeof Math.log2 === 'function' ? Math.log2(2) : null,
      sinh: typeof Math.sinh === 'function' ? Math.sinh(1) : null,
      sqrt: Math.sqrt(2),
      tan: Math.tan(-1e300),
      tanh: typeof Math.tanh === 'function' ? Math.tanh(1) : null,
      E: Math.E,
      LN10: Math.LN10,
      LN2: Math.LN2,
      LOG10E: Math.LOG10E,
      LOG2E: Math.LOG2E,
      PI: Math.PI,
      SQRT1_2: Math.SQRT1_2,
      SQRT2: Math.SQRT2,
    };
  } catch (e) { info.math = { error: e.message }; }

  // DOMRect measurement precision
  try {
    const div = document.createElement('div');
    div.style.cssText = 'width:123.456px;height:78.9px;position:absolute;left:-9999px;top:-9999px';
    document.body.appendChild(div);
    const rect = div.getBoundingClientRect();
    info.domRect = {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
    };
    document.body.removeChild(div);
  } catch (e) {}

  // TextMetrics precision
  try {
    const tCanvas = document.createElement('canvas');
    const tCtx = tCanvas.getContext('2d');
    tCtx.font = '14px Arial';
    const metrics = tCtx.measureText('Hello, World!');
    info.textMetrics = {
      width: metrics.width,
      actualBoundingBoxAscent: metrics.actualBoundingBoxAscent,
      actualBoundingBoxDescent: metrics.actualBoundingBoxDescent,
      actualBoundingBoxLeft: metrics.actualBoundingBoxLeft,
      actualBoundingBoxRight: metrics.actualBoundingBoxRight,
      fontBoundingBoxAscent: metrics.fontBoundingBoxAscent,
      fontBoundingBoxDescent: metrics.fontBoundingBoxDescent,
    };
  } catch (e) {}

  // CSS computed style probes
  try {
    info.cssComputed = {
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontSize: getComputedStyle(document.body).fontSize,
      lineHeight: getComputedStyle(document.body).lineHeight,
      letterSpacing: getComputedStyle(document.body).letterSpacing,
      wordSpacing: getComputedStyle(document.body).wordSpacing,
    };
  } catch (e) {}

  // Window features
  try {
    info.windowFeatures = {
      indexedDB: typeof indexedDB !== 'undefined',
      caches: typeof caches !== 'undefined',
      cookieStore: typeof CookieStore !== 'undefined',
      launchQueue: typeof LaunchQueue !== 'undefined',
      documentPictureInPicture: typeof documentPictureInPicture !== 'undefined',
      sharedStorage: typeof sharedStorage !== 'undefined',
      contentVisibilityAutoStateChange: typeof ContentVisibilityAutoStateChangeEvent !== 'undefined',
      navigation: typeof navigation !== 'undefined',
      documentTransition: typeof document.startViewTransition === 'function',
      viewTransitions: typeof document.startViewTransition === 'function',
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      offscreenCanvasRenderingContext2D: typeof OffscreenCanvasRenderingContext2D !== 'undefined',
      videoFrame: typeof VideoFrame !== 'undefined',
      audioData: typeof AudioData !== 'undefined',
      imageDecoder: typeof ImageDecoder !== 'undefined',
      webCodecs: typeof VideoEncoder !== 'undefined',
      canvasStreamCapture: typeof HTMLCanvasElement.prototype.captureStream === 'function',
    };
  } catch (e) {}

  // Feature detection - various APIs
  try {
    info.featureDetection = {
      shadowDom: typeof ShadowRoot !== 'undefined',
      customElements: typeof customElements !== 'undefined',
      intersectionObserver: typeof IntersectionObserver !== 'undefined',
      mutationObserver: typeof MutationObserver !== 'undefined',
      resizeObserver: typeof ResizeObserver !== 'undefined',
      performanceObserver: typeof PerformanceObserver !== 'undefined',
      reportingObserver: typeof ReportingObserver !== 'undefined',
      contentVisibility: typeof contentVisibilityAutoStateChange !== 'undefined',
      abortController: typeof AbortController !== 'undefined',
      abortSignal: typeof AbortSignal !== 'undefined',
      broadcastChannel: typeof BroadcastChannel !== 'undefined',
      crypto: typeof crypto !== 'undefined',
      subtleCrypto: typeof crypto.subtle !== 'undefined',
      fetch: typeof fetch !== 'function' ? 'polyfill' : 'native',
      webAssembly: typeof WebAssembly !== 'undefined',
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      atob: typeof atob === 'function',
      btoa: typeof btoa === 'function',
    };
  } catch (e) {}

  // DevTools detection
  try {
    const element = new Image();
    Object.defineProperty(element, 'id', {
      get: function () {
        info.devTools = { detected: true };
      },
    });
    console.log('%c', element);
  } catch (e) {}

  // Headless detection signals
  try {
    info.headlessDetection = {
      webdriver: navigator.webdriver,
      automationControlled: document.querySelector('[automationcontrolled]') !== null,
      chrome: !!window.chrome,
      chromeObject: !!window.chrome?.runtime,
      userAgentContainsHeadless: navigator.userAgent.includes('HeadlessChrome'),
      outerWidthZero: window.outerWidth === 0,
      outerHeightZero: window.outerHeight === 0,
      innerWidthZero: window.innerWidth === 0,
      languagesEmpty: !navigator.languages || navigator.languages.length === 0,
    };
  } catch (e) {}

  // Incognito detection (pre-computed in <head>, fallback if not available)
  try {
    if (window.__incognito !== undefined) {
      info.incognito = window.__incognito;
    } else {
      info.incognito = await new Promise((resolve) => {
        let settled = false;
        function done(val) { if (!settled) { settled = true; resolve(val); } }

        const ua = navigator.userAgent;
        const isChromium = !!window.webkitRequestFileSystem || (ua.includes('Chrome') && !ua.includes('Edg') && !ua.includes('OPR'));
        const isFirefox = ua.includes('Firefox') && !ua.includes('Seamonkey');

        if (isChromium && navigator.webkitTemporaryStorage && navigator.webkitTemporaryStorage.queryUsageAndQuota) {
          navigator.webkitTemporaryStorage.queryUsageAndQuota(
            (used, granted) => {
              const heapLimit = performance.memory ? performance.memory.jsHeapSizeLimit : 2 * 1024 * 1024 * 1024;
              done(granted < heapLimit * 2);
            },
            () => done(false)
          );
        } else if (navigator.storage && navigator.storage.getDirectory) {
          navigator.storage.getDirectory().then(
            () => done(false),
            (e) => {
              const msg = e instanceof Error ? e.message : String(e);
              done(msg.includes('Security error') || msg.includes('unknown transient reason'));
            }
          );
        } else {
          done(false);
        }

        setTimeout(() => done(false), 3000);
      });
    }
  } catch (e) {
    info.incognito = false;
  }

  // Prototype integrity checks
  try {
    info.prototypeIntegrity = {
      navigatorToString: Object.prototype.toString.call(navigator),
      navigatorIsArray: Array.isArray(navigator),
      navigatorKeys: Object.keys(navigator).length,
      windowToString: Object.prototype.toString.call(window),
      documentToString: Object.prototype.toString.call(document),
      screenToString: Object.prototype.toString.call(screen),
    };
  } catch (e) {}

  // Window.chrome (Chromium-specific)
  try {
    info.chrome = {
      exists: !!window.chrome,
      runtime: !!window.chrome?.runtime,
      loadTimes: typeof window.chrome?.loadTimes === 'function',
      csi: typeof window.chrome?.csi === 'function',
      app: !!window.chrome?.app,
    };
  } catch (e) {}

  // Safari-specific
  try {
    info.safari = {
      safari: typeof window.safari !== 'undefined',
      pushNotification: typeof window.safari?.pushNotification !== 'undefined',
    };
  } catch (e) {}

  // Firefox-specific
  try {
    info.firefox = {
      mozNotification: typeof MozNotification !== 'undefined',
      mozContacts: typeof navigator.mozContacts !== 'undefined',
    };
  } catch (e) {}

  // Edge-specific
  try {
    info.edge = {
      msCrypto: typeof window.msCrypto !== 'undefined',
    };
  } catch (e) {}

  // Ad blocker detection
  try {
    const adDiv = document.createElement('div');
    adDiv.innerHTML = '&nbsp;';
    adDiv.className = 'adsbox ad-banner advertisement ad-zone ad-unit';
    adDiv.style.cssText = 'position:absolute;top:-10000px;left:-10000px;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(adDiv);
    setTimeout(() => {
      info.adBlocker = {
        detected: adDiv.offsetHeight === 0 || adDiv.clientHeight === 0 || adDiv.getClientRects().length === 0,
      };
      try { document.body.removeChild(adDiv); } catch (e) {}
    }, 100);
  } catch (e) {}

  // Screen frame (bezel sizes)
  try {
    if (window.screen?.availLeft !== undefined) {
      info.screenFrame = {
        top: window.screen.availTop,
        left: window.screen.availLeft,
        right: window.screen.width - window.screen.availWidth - window.screen.availLeft,
        bottom: window.screen.height - window.screen.availHeight - window.screen.availTop,
      };
    }
  } catch (e) {}

  // Window dimensions for toolbar detection
  try {
    info.windowChrome = {
      toolbarHeight: window.outerHeight - window.innerHeight,
      toolbarWidth: window.outerWidth - window.innerWidth,
      sidebarVisible: window.outerWidth - window.innerWidth > 100,
    };
  } catch (e) {}

  // High contrast / forced colors via CSS
  try {
    info.accessibility = {
      prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      prefersColorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      forcedColors: window.matchMedia('(forced-colors: active)').matches,
      reducedTransparency: window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
    };
  } catch (e) {}

  // PDF viewer detection
  try {
    info.pdfViewer = {
      enabled: navigator.pdfViewerEnabled,
      embedType: document.querySelector('embed[type="application/pdf"]') !== null,
      objectType: document.querySelector('object[type="application/pdf"]') !== null,
    };
  } catch (e) {}

  // Speech synthesis voice list (fallback)
  try {
    if (typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().length > 0 && !info.speechSynthesis.voices) {
      const voices = speechSynthesis.getVoices();
      info.speechSynthesis.voices = voices.map(v => ({
        name: v.name,
        lang: v.lang,
        localService: v.localService,
        default: v.default,
        voiceURI: v.voiceURI,
      }));
      info.speechSynthesis.voiceCount = voices.length;
    }
  } catch (e) {}

  // Client hints async collection (non-blocking)
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      navigator.userAgentData.getHighEntropyValues([
        'architecture', 'bitness', 'formFactors', 'fullVersionList',
        'model', 'platformVersion', 'uaFullVersion', 'wow64'
      ]).then(values => {
        info.clientHints = values;
      }).catch(() => {});
    }
  } catch (e) {}

  return info;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { collectAllClientInfo };
}
