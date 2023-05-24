
#ifndef SRC_BLOB_SERDES_H_
#define SRC_BLOB_SERDES_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <sstream>
#include <string>
#include <string_view>
#include <vector>
#include "debug_utils-inl.h"
#include "util.h"

namespace node {

class BlobSerializeDeserializer {
 public:
  BlobSerializeDeserializer(bool is_debug_v) : is_debug(is_debug_v) {}

  template <typename... Args>
  void Debug(const char* format, Args&&... args) const {
    if (is_debug) {
      fprintf(stderr, format, std::forward<Args>(args)...);
    }
  }

  template <typename T>
  std::string ToStr(const T& arg) const {
    std::stringstream ss;
    ss << arg;
    return ss.str();
  }

  template <typename T>
  std::string GetName() const {
#define TYPE_LIST(V)                                                           \
  V(builtins::CodeCacheInfo)                                                   \
  V(PropInfo)                                                                  \
  V(std::string)

#define V(TypeName)                                                            \
  if (std::is_same_v<T, TypeName>) {                                           \
    return #TypeName;                                                          \
  }
    TYPE_LIST(V)
#undef V

    std::string name;
    if (std::is_arithmetic_v<T>) {
      if (!std::is_signed_v<T>) {
        name += "u";
      }
      name += std::is_integral_v<T> ? "int" : "float";
      name += std::to_string(sizeof(T) * 8);
      name += "_t";
    }
    return name;
  }

  bool is_debug = false;
};

// Child classes are expected to implement T Read<T>() where
// !std::is_arithmetic_v<T> && !std::is_same_v<T, std::string>
template <typename Impl>
class BlobDeserializer : public BlobSerializeDeserializer {
 public:
  explicit BlobDeserializer(bool is_debug_v, std::string_view s)
      : BlobSerializeDeserializer(is_debug_v), sink(s) {}
  ~BlobDeserializer() {}

  size_t read_total = 0;
  std::string_view sink;

  Impl* impl() { return static_cast<Impl*>(this); }
  const Impl* impl() const { return static_cast<const Impl*>(this); }

  // Helper for reading numeric types.
  template <typename T>
  T ReadArithmetic() {
    static_assert(std::is_arithmetic_v<T>, "Not an arithmetic type");
    T result;
    ReadArithmetic(&result, 1);
    return result;
  }

  // Layout of vectors:
  // [ 4/8 bytes ] count
  // [   ...     ] contents (count * size of individual elements)
  template <typename T>
  std::vector<T> ReadVector() {
    if (is_debug) {
      std::string name = GetName<T>();
      Debug("\nReadVector<%s>()(%d-byte)\n", name.c_str(), sizeof(T));
    }
    size_t count = static_cast<size_t>(ReadArithmetic<size_t>());
    if (count == 0) {
      return std::vector<T>();
    }
    if (is_debug) {
      Debug("Reading %d vector elements...\n", count);
    }
    std::vector<T> result;
    if constexpr (std::is_arithmetic_v<T>) {
      result = ReadArithmeticVector<T>(count);
    } else {
      result = ReadNonArithmeticVector<T>(count);
    }
    if (is_debug) {
      std::string str = std::is_arithmetic_v<T> ? "" : ToStr(result);
      std::string name = GetName<T>();
      Debug("ReadVector<%s>() read %s\n", name.c_str(), str.c_str());
    }
    return result;
  }

  std::string ReadString() {
    size_t length = ReadArithmetic<size_t>();

    if (is_debug) {
      Debug("ReadString(), length=%d: ", length);
    }

    CHECK_GT(length, 0);  // There should be no empty strings.
    MallocedBuffer<char> buf(length + 1);
    memcpy(buf.data, sink.data() + read_total, length + 1);
    std::string result(buf.data, length);  // This creates a copy of buf.data.

    if (is_debug) {
      Debug("\"%s\", read %zu bytes\n", result.c_str(), length + 1);
    }

    read_total += length + 1;
    return result;
  }
  // Helper for reading an array of numeric types.
  template <typename T>
  void ReadArithmetic(T* out, size_t count) {
    static_assert(std::is_arithmetic_v<T>, "Not an arithmetic type");
    DCHECK_GT(count, 0);  // Should not read contents for vectors of size 0.
    if (is_debug) {
      std::string name = GetName<T>();
      Debug("Read<%s>()(%d-byte), count=%d: ", name.c_str(), sizeof(T), count);
    }

    size_t size = sizeof(T) * count;
    memcpy(out, sink.data() + read_total, size);

    if (is_debug) {
      std::string str =
          "{ " + std::to_string(out[0]) + (count > 1 ? ", ... }" : " }");
      Debug("%s, read %zu bytes\n", str.c_str(), size);
    }
    read_total += size;
  }

  // Helper for reading numeric vectors.
  template <typename Number>
  std::vector<Number> ReadArithmeticVector(size_t count) {
    static_assert(std::is_arithmetic_v<Number>, "Not an arithmetic type");
    DCHECK_GT(count, 0);  // Should not read contents for vectors of size 0.
    std::vector<Number> result(count);
    ReadArithmetic(result.data(), count);
    return result;
  }

 private:
  // Helper for reading non-numeric vectors.
  template <typename T>
  std::vector<T> ReadNonArithmeticVector(size_t count) {
    static_assert(!std::is_arithmetic_v<T>, "Arithmetic type");
    DCHECK_GT(count, 0);  // Should not read contents for vectors of size 0.
    std::vector<T> result;
    result.reserve(count);
    bool original_is_debug = is_debug;
    is_debug = original_is_debug && !std::is_same_v<T, std::string>;
    for (size_t i = 0; i < count; ++i) {
      if (is_debug) {
        Debug("\n[%d] ", i);
      }
      result.push_back(ReadElement<T>());
    }
    is_debug = original_is_debug;

    return result;
  }

  template <typename T>
  T ReadElement() {
    if constexpr (std::is_arithmetic_v<T>) {
      return ReadArithmetic<T>();
    } else if constexpr (std::is_same_v<T, std::string>) {
      return ReadString();
    } else {
      return impl()->template Read<T>();
    }
  }
};

// Child classes are expected to implement size_t Write<T>(const T&) where
// !std::is_arithmetic_v<T> && !std::is_same_v<T, std::string>
template <typename Impl>
class BlobSerializer : public BlobSerializeDeserializer {
 public:
  BlobSerializer(bool is_debug_v) : BlobSerializeDeserializer(is_debug_v) {
    // Currently the snapshot blob built with an empty script is around 4MB.
    // So use that as the default sink size.
    sink.reserve(4 * 1024 * 1024);
  }
  ~BlobSerializer() {}

  Impl* impl() { return static_cast<Impl*>(this); }
  const Impl* impl() const { return static_cast<const Impl*>(this); }

  std::vector<char> sink;

  // Helper for writing numeric types.
  template <typename T>
  size_t WriteArithmetic(const T& data) {
    static_assert(std::is_arithmetic_v<T>, "Not an arithmetic type");
    return WriteArithmetic(&data, 1);
  }

  // Layout of vectors:
  // [ 4/8 bytes ] count
  // [   ...     ] contents (count * size of individual elements)
  template <typename T>
  size_t WriteVector(const std::vector<T>& data) {
    if (is_debug) {
      std::string str = std::is_arithmetic_v<T> ? "" : ToStr(data);
      std::string name = GetName<T>();
      Debug("\nWriteVector<%s>() (%d-byte), count=%d: %s\n",
            name.c_str(),
            sizeof(T),
            data.size(),
            str.c_str());
    }

    size_t written_total = WriteArithmetic<size_t>(data.size());
    if (data.size() == 0) {
      return written_total;
    }

    if constexpr (std::is_arithmetic_v<T>) {
      written_total += WriteArithmeticVector<T>(data);
    } else {
      written_total += WriteNonArithmeticVector<T>(data);
    }

    if (is_debug) {
      std::string name = GetName<T>();
      Debug("WriteVector<%s>() wrote %d bytes\n", name.c_str(), written_total);
    }

    return written_total;
  }

  // The layout of a written string:
  // [  4/8 bytes     ] length
  // [ |length| bytes ] contents
  size_t WriteString(const std::string& data) {
    CHECK_GT(data.size(), 0);  // No empty strings should be written.
    size_t written_total = WriteArithmetic<size_t>(data.size());
    if (is_debug) {
      std::string str = ToStr(data);
      Debug("WriteString(), length=%zu: \"%s\"\n", data.size(), data.c_str());
    }

    // Write the null-terminated string.
    size_t length = data.size() + 1;
    sink.insert(sink.end(), data.c_str(), data.c_str() + length);
    written_total += length;

    if (is_debug) {
      Debug("WriteString() wrote %zu bytes\n", written_total);
    }

    return written_total;
  }

  // Helper for writing an array of numeric types.
  template <typename T>
  size_t WriteArithmetic(const T* data, size_t count) {
    static_assert(std::is_arithmetic_v<T>, "Arithmetic type");
    DCHECK_GT(count, 0);  // Should not write contents for vectors of size 0.
    if (is_debug) {
      std::string str =
          "{ " + std::to_string(data[0]) + (count > 1 ? ", ... }" : " }");
      std::string name = GetName<T>();
      Debug("Write<%s>() (%zu-byte), count=%zu: %s",
            name.c_str(),
            sizeof(T),
            count,
            str.c_str());
    }

    size_t size = sizeof(T) * count;
    const char* pos = reinterpret_cast<const char*>(data);
    sink.insert(sink.end(), pos, pos + size);

    if (is_debug) {
      Debug(", wrote %zu bytes\n", size);
    }
    return size;
  }

  // Helper for writing numeric vectors.
  template <typename Number>
  size_t WriteArithmeticVector(const std::vector<Number>& data) {
    static_assert(std::is_arithmetic_v<Number>, "Arithmetic type");
    return WriteArithmetic(data.data(), data.size());
  }

 private:
  // Helper for writing non-numeric vectors.
  template <typename T>
  size_t WriteNonArithmeticVector(const std::vector<T>& data) {
    static_assert(!std::is_arithmetic_v<T>, "Arithmetic type");
    DCHECK_GT(data.size(),
              0);  // Should not write contents for vectors of size 0.
    size_t written_total = 0;
    bool original_is_debug = is_debug;
    is_debug = original_is_debug && !std::is_same_v<T, std::string>;
    for (size_t i = 0; i < data.size(); ++i) {
      if (is_debug) {
        Debug("\n[%d] ", i);
      }
      written_total += WriteElement<T>(data[i]);
    }
    is_debug = original_is_debug;

    return written_total;
  }

  template <typename T>
  size_t WriteElement(const T& data) {
    if constexpr (std::is_arithmetic_v<T>) {
      return WriteArithmetic<T>(data);
    } else if constexpr (std::is_same_v<T, std::string>) {
      return WriteString(data);
    } else {
      return impl()->template Write<T>(data);
    }
  }
};

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_BLOB_SERDES_H_
