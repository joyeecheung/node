{
  'variables': {
    'V8_ROOT': '../../deps/v8',
    'v8_code': 1,
  },
  'includes': ['toolchain.gypi', 'features.gypi'],
  'targets': [
    {
      # Intermediate target to build libv8_debug_helper.
      # This prevents the dependent settings like node.gypi to link the shared
      # library to the dependent. libv8_debug_helper is only supposed to be
      # loaded at debug time by the debugger plugins in
      # deps/v8/tools/debug_helper/plugins.
      'target_name': 'build_v8_debug_helper_shared',
      'type': 'none',
      'hard_dependency': 1,
      'dependencies': [
        'v8_debug_helper_shared',
      ],
    },  # build_v8_debug_helper_shared
    {
      # Used by and paired with debugger plugins in deps/v8/tools/debug_helper/plugins/.
      # Ported from v8_debug_helper_shared in deps/v8/tools/debug_helper/BUILD.gn.
      'target_name': 'v8_debug_helper_shared',
      'type': 'shared_library',
      'product_name': 'v8_debug_helper',
      'defines': [
        'BUILDING_V8_DEBUG_HELPER',
      ],
      'include_dirs': [
        '<(V8_ROOT)',
        '<(V8_ROOT)/include',
      ],
      'dependencies': [
        'gen_heap_constants',

        'abseil.gyp:abseil',
        'v8.gyp:generate_bytecode_builtins_list',
        'v8.gyp:run_torque',
        'v8.gyp:v8_maybe_icu',
        'v8.gyp:fp16',
        'v8.gyp:v8_libbase',
      ],
      'sources': [
        '<!@pymod_do_main(GN-scraper "<(V8_ROOT)/tools/debug_helper/BUILD.gn"  "_debug_helper_sources = ")',
        "<(SHARED_INTERMEDIATE_DIR)/torque-generated/class-debug-readers.cc",
        "<(SHARED_INTERMEDIATE_DIR)/torque-generated/class-debug-readers.h",
        "<(SHARED_INTERMEDIATE_DIR)/torque-generated/debug-macros.cc",
        "<(SHARED_INTERMEDIATE_DIR)/torque-generated/debug-macros.h",
        "<(SHARED_INTERMEDIATE_DIR)/torque-generated/instance-types.h",
      ],
      'conditions': [
        ['v8_enable_temporal_support==1 and node_shared_temporal_capi=="false"', {
          'dependencies': [
            '../../deps/crates/crates.gyp:temporal_capi',
          ],
        }],
      ],
      # Enable RTTI //build/config/compiler:rtti
      'cflags_cc': [ '-frtti' ],
      'cflags_cc!': [ '-fno-rtti' ],
      'xcode_settings': {
        'GCC_ENABLE_CPP_RTTI': 'YES',  # -frtti
      },
      'msvs_settings': {
        'VCCLCompilerTool': {
          'RuntimeTypeInfo': 'true',
        },
      },
      'configurations': {
        'Release': { # Override target_defaults.Release in common.gypi
          'msvs_settings': {
            'VCCLCompilerTool': {
              'RuntimeTypeInfo': 'true',
            },
          },
        },
      },
    },  # v8_debug_helper_shared
    {
      # Static library for tools linking the debug helper directly,
      # e.g. v8windbg. This should be kept in sync with v8_debug_helper_internal
      # or equivalent in deps/v8/tools/debug_helper/BUILD.gn.
      'target_name': 'v8_debug_helper',
      'type': 'static_library',
      'include_dirs': [
        '<(V8_ROOT)',
        '<(V8_ROOT)/include',
      ],
      'dependencies': [
        'gen_heap_constants',

        'abseil.gyp:abseil',
        'v8.gyp:generate_bytecode_builtins_list',
        'v8.gyp:run_torque',
        'v8.gyp:v8_maybe_icu',
        'v8.gyp:fp16',
        'v8.gyp:v8_libbase',
        'v8.gyp:v8_snapshot',
      ],
      'sources': [
        '<!@pymod_do_main(GN-scraper "<(V8_ROOT)/tools/debug_helper/BUILD.gn"  "_debug_helper_sources = ")',
        "<(SHARED_INTERMEDIATE_DIR)/torque-generated/class-debug-readers.cc",
        "<(SHARED_INTERMEDIATE_DIR)/torque-generated/class-debug-readers.h",
        "<(SHARED_INTERMEDIATE_DIR)/torque-generated/debug-macros.cc",
        "<(SHARED_INTERMEDIATE_DIR)/torque-generated/debug-macros.h",
        "<(SHARED_INTERMEDIATE_DIR)/torque-generated/instance-types.h",
      ],
      'conditions': [
        ['v8_enable_temporal_support==1 and node_shared_temporal_capi=="false"', {
          'dependencies': [
            '../../deps/crates/crates.gyp:temporal_capi',
          ],
        }],
      ],
      # Enable RTTI //build/config/compiler:rtti
      'cflags_cc': [ '-frtti' ],
      'cflags_cc!': [ '-fno-rtti' ],
      'xcode_settings': {
        'GCC_ENABLE_CPP_RTTI': 'YES',  # -frtti
      },
      'msvs_settings': {
        'VCCLCompilerTool': {
          'RuntimeTypeInfo': 'true',
        },
      },
      'configurations': {
        'Release': { # Override target_defaults.Release in common.gypi
          'msvs_settings': {
            'VCCLCompilerTool': {
              'RuntimeTypeInfo': 'true',
            },
          },
        },
      },
    },  # v8_debug_helper
    {
      'target_name': 'gen_heap_constants',
      'type': 'none',
      'hard_dependency': 1,
      'dependencies': [
        'run_mkgrokdump',
      ],
      'direct_dependent_settings': {
        'sources': [
          '<(SHARED_INTERMEDIATE_DIR)/heap-constants-gen.cc',
        ],
      },
      'actions': [
        {
          'action_name': 'run_gen_heap_constants',
          'inputs': [
            '<(V8_ROOT)/tools/debug_helper/gen-heap-constants.py',
          ],
          'outputs': [
            '<(SHARED_INTERMEDIATE_DIR)/heap-constants-gen.cc',
          ],
          'action': [
            '<(python)',
            '<(V8_ROOT)/tools/debug_helper/gen-heap-constants.py',
            '<(SHARED_INTERMEDIATE_DIR)',
            '<@(_outputs)',
          ]
        }
      ]
    },  # gen_heap_constants
    {
      'target_name': 'run_mkgrokdump',
      'type': 'none',
      'hard_dependency': 1,
      'dependencies': [
        'mkgrokdump',
      ],
      'actions': [
        {
          'action_name': 'run_gen_heap_constants',
          'inputs': [
            '<(V8_ROOT)/tools/run.py',
          ],
          'outputs': [
            '<(SHARED_INTERMEDIATE_DIR)/v8heapconst.py',
          ],
          'action': [
            '<(python)',
            '<(V8_ROOT)/tools/run.py',
            '<(PRODUCT_DIR)/<(EXECUTABLE_PREFIX)mkgrokdump<(EXECUTABLE_SUFFIX)',
            '--outfile',
            '<@(_outputs)',
          ]
        }
      ]
    },  # run_mkgrokdump
    {
      'target_name': 'mkgrokdump',
      'type': 'executable',
      'include_dirs': [
        '<(V8_ROOT)',
        '<(V8_ROOT)/include',
      ],
      'dependencies': [
        'abseil.gyp:abseil',
        'v8.gyp:v8_snapshot',
        'v8.gyp:v8_libbase',
        'v8.gyp:v8_libplatform',
        'v8.gyp:v8_maybe_icu',
        'v8.gyp:fp16',
        'v8.gyp:generate_bytecode_builtins_list',
        'v8.gyp:run_torque',
      ],
      'sources': [
        '<!@pymod_do_main(GN-scraper "<(V8_ROOT)/test/mkgrokdump/BUILD.gn"  "mkgrokdump.*?sources = ")',
      ]
    },  # mkgrokdump
  ],
}
