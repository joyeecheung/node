# Copyright (c) 2019 Refael Ackeramnn<refack@gmail.com>. All rights reserved.
# Use of this source code is governed by an MIT-style license.
import os
import sys

from gn_scraper import scrape_gn_list


def DoMain(args):
  gn_filename, pattern = args
  src_root = os.path.dirname(gn_filename)
  files = scrape_gn_list(gn_filename, pattern)
  # always use `/` since GYP will process paths further downstream
  rel_files = ['"%s/%s"' % (src_root, f) for f in files]
  return ' '.join(rel_files)

if __name__ == '__main__':
  print(DoMain(sys.argv[1:]))
