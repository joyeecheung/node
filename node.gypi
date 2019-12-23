{
  # This file is necessary for building the final product (either as a
  # shared lib or an executable). It needs to be paired with
  # node_flags.gypi (for building libs).

  # 'force_load' means to include the static libs into the shared lib or
  # executable. Therefore, it is enabled when building:
  # 1. The executable and it uses static lib (cctest and node)
  # 2. The shared lib
  # Linker optimizes out functions that are not used. When force_load=true,
  # --whole-archive,force_load and /WHOLEARCHIVE are used to include
  # all obj files in static libs into the executable or shared lib.
  'variables': {
    'variables': {
      'variables': {
        'force_load%': 'true',
        'current_type%': '<(_type)',
      },
      'force_load%': '<(force_load)',
      'conditions': [
        ['current_type=="static_library"', {
          'force_load': 'false',
        }],
        [ 'current_type=="executable" and node_target_type=="shared_library"', {
          'force_load': 'false',
        }]
      ],
    },
    'force_load%': '<(force_load)',
  },

  'dependencies': [
    'deps/histogram/histogram.gyp:histogram',
    'deps/uvwasi/uvwasi.gyp:uvwasi',
  ],

  'conditions': [
    [ 'node_shared=="false" and "<(_type)"=="executable"', {
      'msvs_settings': {
        'VCManifestTool': {
          'EmbedManifest': 'true',
          'AdditionalManifestFiles': 'src/res/node.exe.extra.manifest'
        }
      },
    }],
    [ 'OS=="win"', {
      'msvs_precompiled_header': 'tools/msvs/pch/node_pch.h',
      'msvs_precompiled_source': 'tools/msvs/pch/node_pch.cc',
      'sources': [
        '<(_msvs_precompiled_header)',
        '<(_msvs_precompiled_source)',
      ],
    }],
    [ 'node_enable_d8=="true"', {
      'dependencies': [ 'tools/v8_gypfiles/d8.gyp:d8' ],
    }],
    [ 'node_use_bundled_v8=="true"', {
      'dependencies': [
        'tools/v8_gypfiles/v8.gyp:v8_maybe_snapshot',
        'tools/v8_gypfiles/v8.gyp:v8_libplatform',
      ],
    }],
    [ 'v8_enable_i18n_support==1', {
      'dependencies': [
        '<(icu_gyp_path):icui18n',
        '<(icu_gyp_path):icuuc',
      ],
    }],
    [ 'node_shared_zlib=="false"', {
      'dependencies': [ 'deps/zlib/zlib.gyp:zlib' ],
      'conditions': [
        [ 'force_load=="true"', {
          'xcode_settings': {
            'OTHER_LDFLAGS': [
              '-Wl,-force_load,<(PRODUCT_DIR)/<(STATIC_LIB_PREFIX)zlib<(STATIC_LIB_SUFFIX)',
            ],
          },
          'msvs_settings': {
            'VCLinkerTool': {
              'AdditionalOptions': [
                '/WHOLEARCHIVE:zlib<(STATIC_LIB_SUFFIX)',
              ],
            },
          },
          'conditions': [
            ['OS!="aix" and node_shared=="false"', {
              'ldflags': [
                '-Wl,--whole-archive',
                '<(obj_dir)/deps/zlib/<(STATIC_LIB_PREFIX)zlib<(STATIC_LIB_SUFFIX)',
                '-Wl,--no-whole-archive',
              ],
            }],
          ],
        }],
      ],
    }],

    [ 'node_shared_http_parser=="false"', {
      'dependencies': [
        'deps/llhttp/llhttp.gyp:llhttp'
      ],
    } ],

    [ 'node_shared_cares=="false"', {
      'dependencies': [ 'deps/cares/cares.gyp:cares' ],
    }],

    [ 'node_shared_libuv=="false"', {
      'dependencies': [ 'deps/uv/uv.gyp:libuv' ],
      'conditions': [
        [ 'force_load=="true"', {
          'xcode_settings': {
            'OTHER_LDFLAGS': [
              '-Wl,-force_load,<(PRODUCT_DIR)/libuv<(STATIC_LIB_SUFFIX)',
            ],
          },
          'msvs_settings': {
            'VCLinkerTool': {
              'AdditionalOptions': [
                '/WHOLEARCHIVE:libuv<(STATIC_LIB_SUFFIX)',
              ],
            },
          },
          'conditions': [
            ['OS!="aix" and node_shared=="false"', {
              'ldflags': [
                '-Wl,--whole-archive',
                '<(obj_dir)/deps/uv/<(STATIC_LIB_PREFIX)uv<(STATIC_LIB_SUFFIX)',
                '-Wl,--no-whole-archive',
              ],
            }],
          ],
        }],
      ],
    }],

    [ 'node_shared_nghttp2=="false"', {
      'dependencies': [ 'deps/nghttp2/nghttp2.gyp:nghttp2' ],
    }],

    [ 'node_shared_brotli=="false"', {
      'dependencies': [ 'deps/brotli/brotli.gyp:brotli' ],
    }],
    [ 'OS=="aix"', {
      'conditions': [
        [ 'force_load=="true"', {
          'variables': {
            'exp_filename': '<(PRODUCT_DIR)/<(_target_name).exp',
          },
          'actions': [
            {
              'action_name': 'expfile',
              'inputs': [
                '<(obj_dir)',
              ],
              'outputs': [
                '<(exp_filename)',
              ],
              'action': [
                'sh', 'tools/create_expfile.sh',
                '<@(_inputs)',
                '<@(_outputs)',
              ],
            }
          ],
          'ldflags': [
            '-Wl,-bE:<(exp_filename)',
            '-Wl,-brtl',
          ],
        }],
      ],
    }],
    [ '(OS=="freebsd" or OS=="linux") and node_shared=="false"'
        ' and force_load=="true"', {
      'ldflags': [
        '-Wl,-z,noexecstack',
        '-Wl,--whole-archive <(v8_base)',
        '-Wl,--no-whole-archive',
      ]
    }],
    [ 'node_use_bundled_v8=="true" and v8_postmortem_support==1 and force_load=="true"', {
      'xcode_settings': {
        'OTHER_LDFLAGS': [
          '-Wl,-force_load,<(v8_base)',
        ],
      },
    }],
    [ 'OS=="sunos"', {
      'ldflags': [ '-Wl,-M,/usr/lib/ld/map.noexstk' ],
    }],
    [ 'node_use_openssl=="true"', {
      'conditions': [
        [ 'node_shared_openssl=="false"', {
          'dependencies': [
            './deps/openssl/openssl.gyp:openssl',

            # For tests
            './deps/openssl/openssl.gyp:openssl-cli',
          ],
          'conditions': [
            # -force_load or --whole-archive are not applicable for
            # the static library
            [ 'force_load=="true"', {
              'xcode_settings': {
                'OTHER_LDFLAGS': [
                  '-Wl,-force_load,<(PRODUCT_DIR)/<(openssl_product)',
                ],
              },
              'msvs_settings': {
                'VCLinkerTool': {
                  'AdditionalOptions': [
                    '/WHOLEARCHIVE:<(openssl_product)',
                  ],
                },
              },
              'conditions': [
                ['OS in "linux freebsd" and node_shared=="false"', {
                  'ldflags': [
                    '-Wl,--whole-archive,'
                      '<(obj_dir)/deps/openssl/<(openssl_product)',
                    '-Wl,--no-whole-archive',
                  ],
                }],
                # openssl.def is based on zlib.def, zlib symbols
                # are always exported.
                ['use_openssl_def==1', {
                  'sources': ['<(SHARED_INTERMEDIATE_DIR)/openssl.def'],
                }],
                ['OS=="win" and use_openssl_def==0', {
                  'sources': ['deps/zlib/win32/zlib.def'],
                }],
              ],
            }],
          ],
        }]]
    }],
  ],
}
