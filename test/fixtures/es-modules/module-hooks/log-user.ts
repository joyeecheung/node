
import { UserAccount, User } from './user.ts';
import { log } from 'node:console';
const user: User = new UserAccount('john', 100);
log(user);
