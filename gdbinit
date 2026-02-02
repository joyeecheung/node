python

from gdb.unwinder import Unwinder

class V8UnwinderFrameId(object):
  def __init__(self, sp, pc):
    self.sp = sp
    self.pc = pc

class V8Unwinder(Unwinder):
  def __init__(self):
    super(V8Unwinder, self).__init__("V8Unwinder")
    self.enabled = True

  def __call__(self, pending_frame):
    try:
      # Only supported on x64.
      if gdb.selected_inferior().architecture().name() != "i386:x86-64":
        return None

      pc = pending_frame.read_register("rip")
      sym_and_line = gdb.current_progspace().find_pc_line(int(pc))

      if sym_and_line.symtab is not None:
        return None
      fp = pending_frame.read_register("rbp").reinterpret_cast(
          gdb.lookup_type("void").pointer().pointer())

      next_sp = fp
      next_fp = fp.dereference()
      next_pc = (fp+1).dereference()

      frame_info = V8UnwinderFrameId(next_sp, next_pc)

      # create_unwind_info seems to sometimes have issues accessing
      # the frame_info if it's not first accessed in Python.
      _lol_gdb_workaround = frame_info.pc + 1

      unwind_info = pending_frame.create_unwind_info(frame_info)
      unwind_info.add_saved_register("rsp", next_sp)
      unwind_info.add_saved_register("rip", next_pc)
      unwind_info.add_saved_register("rbp", next_fp)
      return unwind_info
    except Exception as e:
      return None

gdb.unwinder.register_unwinder(None, V8Unwinder(), replace=True)

end
