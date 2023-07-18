{
  'targets': [
    {
      'target_name': 'lz4',
      'toolsets': ['host', 'target'],
      'type': 'static_library',
      'include_dirs': ['lib'],
      'direct_dependent_settings': {
        'include_dirs': ['lib'],
      },
      'sources': [
        'lib/lz4.c',
        'lib/lz4file.c',
        'lib/lz4frame.c',
        'lib/lz4hc.c',
        'lib/xxhash.c'
      ]
    },
  ]
}
