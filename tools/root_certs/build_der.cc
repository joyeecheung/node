#include <openssl/bio.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <sstream>
#include <fstream>
#include <optional>
#include "executable_wrapper.h"
#include "embedded_data.h"

#if defined(_WIN32)
#include <io.h>  // _S_IREAD _S_IWRITE
#ifndef S_IRUSR
#define S_IRUSR _S_IREAD
#endif  // S_IRUSR
#ifndef S_IWUSR
#define S_IWUSR _S_IWRITE
#endif  // S_IWUSR
#endif

namespace node {
int Main(int argc, char* argv[]);

// This callback is used to avoid the default passphrase callback in OpenSSL
// which will typically prompt for the passphrase. The prompting is designed
// for the OpenSSL CLI, but works poorly for Node.js because it involves
// synchronous interaction with the controlling terminal, something we never
// want, and use this function to avoid it.
int NoPasswordCallback(char* buf, int size, int rwflag, void* u) {
  return 0;
}

std::optional<std::string> PEM2DER(const char* pem_data,
                size_t pem_length) {
  BIO* bio = BIO_new_mem_buf(pem_data, pem_length);
  if (!bio) {
    fprintf(stderr, "Error allocating BIO for the PEM certificate.\n");
    return std::nullopt;
  }

  X509* cert = PEM_read_bio_X509(
      bio,
      nullptr,  // no re-use of X509 structure
      NoPasswordCallback,
      nullptr);  // no callback data

  if (!cert) {
    BIO_free(bio);
    fprintf(stderr, "Error reading PEM certificate into BIO.\n");
    return std::nullopt;
  }

  // Create a BIO object to write DER data to memory.
  BIO* bio_der = BIO_new(BIO_s_mem());

  if (!bio_der) {
    fprintf(stderr, "Error allocationg BIO for the DER certificate.\n");
    X509_free(cert);
    BIO_free(bio);
    return std::nullopt;
  }

  // Write the DER certificate to the BIO.
  if (!i2d_X509_bio(bio_der, cert)) {
    fprintf(stderr, "Error writing DER certificate to BIO.\n");
    X509_free(cert);
    BIO_free(bio);
    BIO_free(bio_der);
    return std::nullopt;
  }

  // Get the DER data from the BIO.
  unsigned char* out_der_data = nullptr;
  size_t out_der_length = BIO_get_mem_data(bio_der, &out_der_data);

  std::stringstream ss;
  for (size_t i = 0; i < out_der_length; ++i) {
    uint8_t ch = static_cast<uint8_t>(out_der_data[i]);
    const std::string& str = GetOctalCode(ch);
    ss << str;
    if (i % 64 == 63) {
      // Go to a newline every 64 bytes since text editors may have
      // problems with very long lines.
      ss << "\"\n\"";
    }
  }

  // Clean up resources
  X509_free(cert);
  BIO_free(bio);
  BIO_free(bio_der);

  return ss.str();
}

#define NODE_WANT_INTERNALS 1

static const char* const root_certs[] = {
#include "node_root_certs.h"  // NOLINT(build/include_order)
};

template <typename T, size_t N>
constexpr size_t arraysize(const T (&)[N]) {
  return N;
}

int BuilDERSource(int argc, char* argv[]) {
  OPENSSL_init_crypto(OPENSSL_INIT_LOAD_CONFIG, nullptr);

  std::ofstream os(argv[1], std::ofstream::out);
  os << "#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS\n";

  for (size_t i = 0; i < arraysize(root_certs); i++) {
    const char* pem_cert = root_certs[i];
    size_t pem_length = strlen(pem_cert);

    std::optional<std::string> der = PEM2DER(pem_cert, pem_length);
    if (!der.has_value()) {
      return -1;
    }

    os << "\"" << der.value() << "\",\n\n";
  }

  os << "#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS\n";

  os.close();

  if (!os) {
    fprintf(stderr, "Error when trying to write %s\n", argv[1]);
    return -1;
  }

  return 0;
}

}  // namespace node

int PrintUsage(const char* argv0) {
  // TODO(joyeecheung): it may be useful to provide an extra argument
  // for embedders to add their own certificates.
  fprintf(stderr,
          "Usage: %s path/to/output.cc\n",
          argv0);
  return 1;
}

NODE_MAIN(int argc, node::argv_type raw_argv[]) {
  char** argv;
  node::FixupMain(argc, raw_argv, &argv);
  if (argc < 2) {
    return PrintUsage(argv[0]);
  }

  return node::BuilDERSource(argc, argv);
}
