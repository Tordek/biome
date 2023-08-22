import fs from "fs";
import child_process from "child_process";
import path from "path";
import os from "os";

const TMP_DIRECTORY = path.resolve("./target");

function buildBiome() {
	console.log("Build Biome...");

	child_process.execSync("cargo build --bin biome --release", {
		stdio: "inherit",
	});

	return path.resolve("../target/release/biome");
}

const BENCHMARKS = {
	formatter: {
		webpack: {
			repository: "https://github.com/webpack/webpack.git",
			sourceDirectories: {
				lib: ["js"],
				examples: ["js"],
				declarations: ["ts"],
				benchmark: ["js"],
			},
		},
		prettier: {
			repository: "https://github.com/prettier/prettier.git",
			sourceDirectories: {
				src: ["js"],
				scripts: ["js"],
			},
		},
	},
	linter: {
		eslint: {
			repository: "https://github.com/eslint/eslint.git",
			sourceDirectories: [
				"lib",
				"messages",
				"tests/lib",
				"tests/performance",
				"tools",
			],
		},
		webpack: {
			repository: "https://github.com/webpack/webpack.git",
			sourceDirectories: ["lib"],
		},
	},
};

function getDirsToClone(sourceDirs) {
	if (typeof sourceDirs !== 'object' || sourceDirs === null) {
		return;
	}

	if (Array.isArray(sourceDirs)) {
		return sourceDirs;
	}

	return Object.keys(sourceDirs);
}

function benchmarkFormatter(biome) {
	console.log("");
	console.log("Benchmark formatter...");
	console.log("―".repeat(80));
	console.log("");

	// Run Dprint once to run the installer
	child_process.execSync("npx dprint --version");

	for (const [name, configuration] of Object.entries(BENCHMARKS.formatter)) {
		console.log(`[${name}]`);

		let projectDirectory = cloneProject(name, configuration.repository, getDirsToClone(configuration.sourceDirectories));

		const prettierPaths = Object.entries(configuration.sourceDirectories)
			.flatMap(([directory, extensions]) => {
				return extensions.map(
					(extension) => `'${path.join(directory, `**/*.${extension}`)}'`,
				);
			})
			.join(" ");

		const prettierCommand = `node '${resolvePrettier()}' ${prettierPaths} --write --log-level=error`;
		const parallelPrettierCommand = `node '${resolveParallelPrettier()}' ${prettierPaths} --write --concurrency ${os.cpus().length}`;

		const dprintCommand = `${resolveDprint()} fmt --incremental=false --config '${require.resolve("./dprint.json")}' ${Object.keys(configuration.sourceDirectories).map(path => `'${path}/**/*'`).join(" ")}`;

		const biomeCommand = `${biome} format --max-diagnostics=0 ${Object.keys(
			configuration.sourceDirectories,
		)
			.map((path) => `'${path}'`)
			.join(" ")} --write`;

		const biomeSingleCoreCommand = withEnvVariable(
			"RAYON_NUM_THREADS",
			"1",
			biomeCommand,
		);

		// Run 2 warmups to make sure the files are formatted correctly
		const hyperfineCommand = `hyperfine --show-output -w 2 -n Prettier "${prettierCommand}" -n "Parallel-Prettier" "${parallelPrettierCommand}" -n dprint "${dprintCommand}" -n Biome "${biomeCommand}" --shell=${shellOption()} -n "Biome (1 thread)" "${biomeSingleCoreCommand}"`;
		console.log(hyperfineCommand);

		child_process.execSync(hyperfineCommand, {
			cwd: projectDirectory,
			stdio: "inherit",
		});
	}
}

function resolvePrettier() {
	return path.resolve("node_modules/prettier/bin/prettier.cjs");
}

function resolveParallelPrettier() {
	return path.resolve("node_modules/@mixer/parallel-prettier/dist/index.js");
}

function resolveDprint() {
	return path.resolve("node_modules/dprint/dprint");
}

function benchmarkLinter(biome) {
	console.log("");
	console.log("Benchmark linter...");
	console.log("―".repeat(80));
	console.log("");

	for (const [name, configuration] of Object.entries(BENCHMARKS.linter)) {
		console.log(`[${name}]`);

		const projectDirectory = cloneProject(name, configuration.repository, getDirsToClone(configuration.sourceDirectories));

		deleteFile(path.join(projectDirectory, ".eslintignore"));
		deleteFile(path.join(projectDirectory, ".eslintrc.js"));
		deleteFile(path.join(projectDirectory, ".eslintrc.cjs"));
		deleteFile(path.join(projectDirectory, ".eslintrc.json"));
		deleteFile(path.join(projectDirectory, ".eslintrc.yaml"));
		deleteFile(path.join(projectDirectory, ".eslintrc.yml"));
		deleteFile(path.join(projectDirectory, "eslint.config.js"));
		deleteFile(path.join(projectDirectory, "rome.json"));
		deleteFile(path.join(projectDirectory, "biome.json"));

		const eslintPaths = configuration.sourceDirectories
			.map((directory) => `'${directory}/**'`)
			.join(" ");

		const eslintCommand = `node '${resolveESlint()}' --no-ignore ${eslintPaths}`;

		const biomePaths = configuration.sourceDirectories
			.map((directory) => `'${directory}'`)
			.join(" ");

		// Don't compute the code frames for pulled diagnostics. ESLint doesn't do so as well.
		const biomeCommand = `${biome} lint --max-diagnostics=0 ${biomePaths}`;

		const biomeSingleCoreCommand = withEnvVariable(
			"RAYON_NUM_THREADS",
			"1",
			biomeCommand,
		);

		// Run 2 warmups to make sure the files are formatted correctly
		const hyperfineCommand = `hyperfine -i -w 2 -n ESLint "${eslintCommand}" -n Biome "${biomeCommand}" --shell=${shellOption()} -n "Biome (1 thread)" "${biomeSingleCoreCommand}"`;
		console.log(hyperfineCommand);

		child_process.execSync(hyperfineCommand, {
			cwd: projectDirectory,
			stdio: "inherit",
		});
	}
}

function resolveESlint() {
	return path.resolve("node_modules/eslint/bin/eslint.js");
}

function shellOption() {
	switch (process.platform) {
		case "win32":
			// Use Powershell so that it is possible to set an environment variable for a single command (ugh!)
			return "powershell";
		default:
			return "default";
	}
}

function withEnvVariable(name, value, command) {
	switch (process.platform) {
		case "win32": {
			return `$Env:${name}=${value}; ${command}`;
		}
		default:
			return `${name}=\"${value}\" ${command}`;
	}
}

function withDirectory(cwd) {
	return {
		run(command, options) {
			child_process.execSync(command, {
				cwd,
				...options,
			});
		},
	};
}

function deleteFile(path) {
	if (fs.existsSync(path)) {
		fs.rmSync(path);
	}
}

function cloneProject(name, repository, dirs = []) {
	let projectDirectory = path.join(TMP_DIRECTORY, name);

	let inProjectDirectory = withDirectory(projectDirectory);

	if (fs.existsSync(projectDirectory)) {
		console.log(`Updating git repository in directory ${projectDirectory}`);
		inProjectDirectory.run("git reset --hard @{u}");
		inProjectDirectory.run("git clean -df");
		inProjectDirectory.run("git pull --depth=1 --ff-only");
	} else {
		console.log("Clone project...");

		withDirectory(TMP_DIRECTORY).run(`git clone ${dirs.length > 0 ? '--sparse' : ''} --depth=1 ${repository}`, {
			stdio: "inherit",
		});
	}

	if (dirs.length > 0) {
		console.log(`Adding directories ${dirs.join()} to sparse checkout in ${projectDirectory}`)
		inProjectDirectory.run(`git sparse-checkout add ${dirs.join(' ')}`);
	}

	return projectDirectory;
}

function run() {
	fs.mkdirSync("target", { recursive: true });

	const biome = buildBiome();

	//benchmarkFormatter(biome);
	benchmarkLinter(biome);
}

run();
