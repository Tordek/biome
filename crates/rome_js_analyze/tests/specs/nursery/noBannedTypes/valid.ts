let f = Object();

let foo: { x: number; y: number } = { x: 1, y: 1 };

let g = Object.create(null);

let h = String(false);

let b: undefined;

let c: null;

let a: [];

let tuple: [boolean, string] = [true, "hello"];

type Props = {
	foo: string;
}