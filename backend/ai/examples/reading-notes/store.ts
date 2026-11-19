/**
 * 读书笔记 —— **示例系统自己的业务数据**（玩具级：放内存里）。
 *
 * ## 为什么放在内存里
 *
 * 这个示例要证明的是「**内核换个业务系统照样能用**」⇒ 业务数据怎么存**不重要**。
 * 真接一个业务系统时，这里换成自己的数据源即可（内核不关心）。
 *
 * ⚠️ 进程重启就没了 ⇒ 这就是「示例」而不是「产品」。
 */

/** 一条读书笔记。 */
export interface Note {
	/** 笔记 id（示例里用序号）。 */
	id: string;
	/** 书名。 */
	title: string;
	/** 作者（可省）。 */
	author?: string;
	/** 读后感 / 摘录（可省）。 */
	thought?: string;
	/** 记下的时间（ISO 字符串）。 */
	createdAt: string;
}

/** 新建一条笔记时的入参。 */
export interface AddNoteInput {
	title: string;
	author?: string;
	thought?: string;
}

/** 笔记库（**进程内** ⇒ 重启即空）。 */
const notes: Note[] = [];

/** 下一个笔记 id。 */
let nextId = 1;

/** 记一条笔记 ⇒ 返回记好的那条。 */
export function addNote(input: AddNoteInput): Note {
	const note: Note = {
		id: `note-${nextId}`,
		title: input.title,
		...(input.author === undefined ? {} : { author: input.author }),
		...(input.thought === undefined ? {} : { thought: input.thought }),
		createdAt: new Date().toISOString(),
	};
	nextId += 1;
	notes.push(note);
	return note;
}

/** 列全部笔记（按记下的顺序）。 */
export function listNotes(): Note[] {
	return [...notes];
}

/** 清空（**测试用**）。 */
export function resetNotes(): void {
	notes.length = 0;
	nextId = 1;
}
