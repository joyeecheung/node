// Copyright 2024 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef INCLUDE_CPPGC_EXTERNAL_H_
#define INCLUDE_CPPGC_EXTERNAL_H_

#include <cstddef>

namespace cppgc {

class Visitor;

class External {
 public:
  virtual void Trace(cppgc::Visitor*) const {}
  virtual const char* GetHumanReadableName() const = 0;
  virtual size_t GetSize() const = 0;
};

}  // namespace cppgc

#endif  // INCLUDE_CPPGC_EXTERNAL_H_
