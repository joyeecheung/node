{
  # This file is necessary for building libs. To build the final product
  # (either as a shared lib or an executable), node.gypi also needs to be
  # included.
  'defines': [
    'NODE_WANT_INTERNALS=1'
  ],
  'conditions': [
    [ 'clang==1', {
      'cflags': [ '-Werror=undefined-inline', ]
    }],
    [ 'node_shared=="true"', {
      'defines': [
        'NODE_SHARED_MODE',
      ],
    }],
    [ 'OS=="win"', {
      'defines!': [
        'NODE_PLATFORM="win"',
      ],
      'defines': [
        'FD_SETSIZE=1024',
        # we need to use node's preferred "win32" rather than gyp's preferred "win"
        'NODE_PLATFORM="win32"',
        # Stop <windows.h> from defining macros that conflict with
        # std::min() and std::max().  We don't use <windows.h> (much)
        # but we still inherit it from uv.h.
        'NOMINMAX',
        '_UNICODE=1',
      ],
    }, { # POSIX
      'defines': [ '__POSIX__' ],
    }],
    [ 'node_use_v8_platform=="true"', {
      'defines': [
        'NODE_USE_V8_PLATFORM=1',
      ],
    }, {
      'defines': [
        'NODE_USE_V8_PLATFORM=0',
      ],
    }],
    [ 'node_tag!=""', {
      'defines': [ 'NODE_TAG="<(node_tag)"' ],
    }],
    [ 'node_v8_options!=""', {
      'defines': [ 'NODE_V8_OPTIONS="<(node_v8_options)"'],
    }],
    [ 'node_release_urlbase!=""', {
      'defines': [
        'NODE_RELEASE_URLBASE="<(node_release_urlbase)"',
      ]
    }],
    [ 'v8_enable_i18n_support==1', {
      'defines': [ 'NODE_HAVE_I18N_SUPPORT=1' ],

      'conditions': [
        [ 'icu_small=="true"', {
          'defines': [ 'NODE_HAVE_SMALL_ICU=1' ],
          'conditions': [
            [ 'icu_default_data!=""', {
              'defines': [
                'NODE_ICU_DEFAULT_DATA_DIR="<(icu_default_data)"',
              ],
            }],
          ],
      }]],
    }],
    [ 'node_no_browser_globals=="true"', {
      'defines': [ 'NODE_NO_BROWSER_GLOBALS' ],
    } ],

    [ 'OS=="mac"', {
      # linking Corefoundation is needed since certain OSX debugging tools
      # like Instruments require it for some features
      'libraries': [ '-framework CoreFoundation' ],
      'defines!': [
        'NODE_PLATFORM="mac"',
      ],
      'defines': [
        # we need to use node's preferred "darwin" rather than gyp's preferred "mac"
        'NODE_PLATFORM="darwin"',
      ],
    }],
    [ 'OS=="freebsd"', {
      'libraries': [
        '-lutil',
        '-lkvm',
      ],
    }],
    [ 'OS=="aix"', {
      'defines': [
        '_LINUX_SOURCE_COMPAT',
        '__STDC_FORMAT_MACROS',
      ],
    }],
    [ 'OS=="solaris"', {
      'libraries': [
        '-lkstat',
        '-lumem',
      ],
      'defines!': [
        'NODE_PLATFORM="solaris"',
      ],
      'defines': [
        # we need to use node's preferred "sunos"
        # rather than gyp's preferred "solaris"
        'NODE_PLATFORM="sunos"',
      ],
    }],
    [ 'coverage=="true" and node_shared=="false" and OS in "mac freebsd linux"', {
      'cflags!': [ '-O3' ],
      'ldflags': [ '--coverage',
                   '-g',
                   '-O0' ],
      'cflags': [ '--coverage',
                   '-g',
                   '-O0' ],
      'xcode_settings': {
        'OTHER_CFLAGS': [
          '--coverage',
          '-g',
          '-O0'
        ],
      },
      'conditions': [
        [ '_type=="executable"', {
          'xcode_settings': {
            'OTHER_LDFLAGS': [ '--coverage', ],
          },
        }],
      ],
    }],
    [ 'OS=="linux"', {
      'libraries!': [
        '-lrt'
      ],
    }],
    [ 'OS in "freebsd linux"', {
      'ldflags': [ '-Wl,-z,relro',
                   '-Wl,-z,now' ]
    }],
    [ 'OS=="linux" and '
      'target_arch=="x64" and '
      'llvm_version=="0.0"', {
      'ldflags': [
        '-Wl,-T',
        '<!(realpath src/large_pages/ld.implicit.script)',
      ]
    }],
    [ 'OS=="linux" and '
      'target_arch=="x64" and '
      'llvm_version!="0.0"', {
      'ldflags': [
        '-Wl,-T',
        '<!(realpath src/large_pages/ld.implicit.script.lld)',
      ]
    }],
    [ 'node_use_openssl=="true"', {
      'defines': [ 'HAVE_OPENSSL=1' ],
    }, {
      'defines': [ 'HAVE_OPENSSL=0' ]
    }],
    ['v8_enable_inspector==1', {
      'defines': [ 'HAVE_INSPECTOR=1', ],
    }, {
      'defines': [ 'HAVE_INSPECTOR=0', ]
    }],
  ],
}
