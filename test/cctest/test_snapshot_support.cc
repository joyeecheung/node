#include "snapshot_support-inl.h"
#include "gtest/gtest.h"
#include <sstream>

TEST(SnapshotSupportTest, DumpWithoutErrors) {
  node::SnapshotCreateData data_w(nullptr);

  data_w.StartWriteEntry("Outer");
  data_w.WriteUint32(10);
  data_w.StartWriteEntry("Inner");
  data_w.WriteString("Hello!");
  data_w.EndWriteEntry();
  data_w.EndWriteEntry();

  node::SnapshotReadData data_r(data_w.release_storage());
  std::ostringstream os;
  data_r.Dump(os);

  // The indices in this test can be updated at any time.
  EXPECT_EQ(os.str(),
      " 0 StartEntry: [Outer]\n"
      "16   Uint32: 10\n"
      "21   StartEntry: [Inner]\n"
      "37     String: \"Hello!\"\n"
      "53     EndEntry\n"
      "54   EndEntry\n");
}

TEST(SnapshotSupportTest, DumpWithErrors) {
  node::SnapshotCreateData data_w(nullptr);

  data_w.StartWriteEntry("Outer");
  data_w.WriteUint32(10);
  data_w.StartWriteEntry("Inner");
  data_w.WriteString("Hello!");
  data_w.EndWriteEntry();
  data_w.EndWriteEntry();

  std::vector<uint8_t> storage = data_w.release_storage();
  storage[21]++;  // Invalidate storage data in some way.
  node::SnapshotReadData data_r(std::move(storage));
  std::ostringstream os;
  data_r.Dump(os);

  // The indices in this test can be updated at any time.
  EXPECT_EQ(os.str(),
      " 0 StartEntry: [Outer]\n"
      "16   Uint32: 10\n"
      "21   EndEntry\n"
      "22 String: \"Inner\"\n"
      "37 String: \"Hello!\"\n"
      "53 \n"
      "1 errors found:\n"
      "- At [54]  Attempting to end entry on empty stack\n");
}
