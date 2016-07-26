import * as gutil from "gulp-util";
import * as stream from "stream";
import * as ts from "typescript";

const PLUGIN_NAME: string = "gulp-dts2externs";

/**
 * Available output styles
 */
export enum OutputStyle {
    obj
    , proto
}

/**
 * dts2externs options
 */
export interface IOptions {
    addConsole?: boolean;
    outputStyle?: OutputStyle;
    keepComments?: boolean;
    allowTsFiles?: boolean;
    parseNonExportedNodesInTsFiles?: boolean;
    listParsedFiles?: boolean;
    debugOutput?: boolean;
}

/**
 * Gulp options
 */
export interface IGulpOptions extends IOptions {
    outputFilename?: string;
}

/**
 * Output entry format
 */
interface IOutputEntry {
    documentation?: string;
    members?: { [name: string]: IOutputEntry };
    type: string;
}

/**
 * gulp plugin function
 */
export function gulp(): Function {
    return (options: IGulpOptions = {}) => {

        // convert string to enum
        if (typeof (options.outputStyle) === "string") {
            options.outputStyle = <any> OutputStyle[<any> options.outputStyle];
        }

        return new GulpDts2Externs(options);
    };
}

/**
 * Gulp plugin implementation
 */
export class GulpDts2Externs extends stream.Transform {
    private Options: IGulpOptions;
    private Filenames: string[];

    constructor(options: IGulpOptions = {}) {
        super({
            objectMode: true
        });

        this.Filenames = [];
        this.Options = options;
        if (!this.Options.outputFilename) {
            this.Options.outputFilename = "externs.js";
        }
    }

    public _transform(file: any, encoding: string, callback: Function): void {
        if (file.isNull()) {
            callback();
            return;
        }

        if (file.isStream()) {
            this.emit("error", new gutil.PluginError(PLUGIN_NAME, "Streaming not supported"));
            callback();
            return;
        }

        this.Filenames.push(file.path);

        callback();
    }

    public _flush(callback: Function): void {
        let generator = new Dts2Externs(this.Filenames, this.Options);
        let output = generator.Generate();

        let file = new gutil.File({contents: new Buffer(output), path: this.Options.outputFilename});

        this.push(file);

        callback();
    }
}

/**
 * 
 * @param filenames
 * @param options
 */
export function generate(filenames: string[], options: IOptions): string {
    return new Dts2Externs(filenames, options).Generate();
}

/**
 * Parse d.ts files and output externs
 * @param filenames
 * @param options
 */
export class Dts2Externs {
    private Program: ts.Program;
    private Checker: ts.TypeChecker;

    private OutputEntries: { [name: string]: IOutputEntry } = {};

    private CurrentFileIsDts: boolean;

    private Options: IOptions;
    private FileNames: string[];

    /**
     * Skipping these symbols because:
     * - they are always included in closure compiler default externs - no need to export
     * - they are stuff that ends up getting parsed because of shitty coding
     */
    private SkipSymbols: string[] = [
        "export="
        , "Map"
        , "Symbol"
        , "Error"
        , "escape"
        , "unescape"
    ];

    private consoleMemberNames: string[] = [
        "log"
        , "info"
        , "warn"
        , "error"
        , "dir"
        , "time"
        , "timeEnd"
        , "trace"
        , "assert"
    ];

    constructor(fileNames: string[], options: IOptions) {
        this.Options = options;
        this.FileNames = fileNames;

        // Add console.log, console.error, etc.. to output
        if (this.Options.addConsole) {
            this.OutputSymbol(this.FakeSymbol("console"), "class");

            for (let name of this.consoleMemberNames) {
                this.AddMember(this.FakeSymbol("console"), this.FakeSymbol(name));
            }
        }
    }

    /**
     * Parse d.ts files and output externs
     * @param fileNames
     * @param options
     */
    public Generate(): string {
        // TODO: necessary? 
        let compilerOptions: ts.CompilerOptions = {
            declaration: true
            , module: ts.ModuleKind.CommonJS
            , target: ts.ScriptTarget.ES5
        };

        // Build a program using the set of root file names in fileNames
        this.Program = ts.createProgram(this.FileNames, compilerOptions);

        // Get the checker, we will use it to check nodes
        this.Checker = this.Program.getTypeChecker();

        // Visit every sourceFile in the program    
        for (let sourceFile of this.Program.getSourceFiles()) {

            // set dts flag for current file
            this.CurrentFileIsDts = /\.d\.ts$/.test(sourceFile.fileName);
            if (
                // skip default libs (default libs should have hasNoDefaultLib===true)
                sourceFile.hasNoDefaultLib !== true

                // skip non d.ts files unless specificly allowed in Options
                && (this.Options.allowTsFiles || this.CurrentFileIsDts)
            ) {
                if (this.Options.listParsedFiles) {
                    process.stderr.write(`parsing: ${sourceFile.fileName}`);
                }

                // Walk the tree and export what we need
                ts.forEachChild(sourceFile, this.Visit.bind(this));
            }
            else {
                // Report if not parsing and debugOutput is requested
                if (this.Options.debugOutput) {
                    process.stderr.write(`INFO: skipping: ${sourceFile.fileName}`);
                }
            }
        }

        return this.ConvertOutputEntriesToString();
    }

    /**
     * Returns a fake ts.Symbol to use in output functions
     * @param name
     */
    private FakeSymbol(name: string): ts.Symbol {
        return {
            flags: null
            , getDeclarations: null
            , getDocumentationComment: () => { return []; }
            , getFlags: null
            , getName: null
            , name: name
        };
    }

    /**
     * Output prototype formatted externs
     * @param name
     * @param entry
     */
    private OutputTypePrototype(name: string, entry: IOutputEntry): string {
        let outputString = `function ${name}() {};\n`;

        for (let member in entry.members) {
            if (this.SkipSymbols.indexOf(member) !== -1) { continue; }

            // only output if member name does not start with number
            if (/^[^0-9](.*)/.test(member)) {
                if (this.Options.keepComments && entry.members[member].documentation) {
                    outputString += entry.members[member].documentation;
                }
                outputString += `${name}.prototype.${member};\n`;
            }
        }

        return outputString;
    }

    /**
     * Output object formatted externs
     * @param name
     * @param entry
     */
    private OutputTypeObject(name: string, entry: IOutputEntry): string {
        let outputString = `var ${name} = {\n`;

        let first = true;
        for (let member in entry.members) {
            if (this.SkipSymbols.indexOf(member) !== -1) { continue; }

            if (this.Options.keepComments && entry.members[member].documentation) {
                outputString += entry.members[member].documentation;
            }

            if (first) {
                outputString += "\t ";
                first = false;
            }
            else {
                outputString += "\t,";
            }
            // normal output if member name does not start with number
            if (/^[^0-9](.*)/.test(member)) {
                outputString += `${member}: function() {}\n`;
            }
            // output with quotes if member name starts with number
            else {
                outputString += `"${member}": function() {}\n`;
            }
        }

        outputString += "};\n";

        return outputString;
    }

    /**
     * Convert output entries to string
     */
    private ConvertOutputEntriesToString(): string {
        let outputStyleFunc: (name: string, entry: IOutputEntry) => {};
        if (this.Options.outputStyle === OutputStyle.proto) {
            outputStyleFunc = this.OutputTypePrototype.bind(this);
        }
        else {
            outputStyleFunc = this.OutputTypeObject.bind(this);
        }

        let outputString = "";

        for (let name in this.OutputEntries) {
            // Skip symbols that don"t need exporting
            if (this.SkipSymbols.indexOf(name) !== -1) { continue; }

            if (this.Options.keepComments && this.OutputEntries[name].documentation) {
                outputString += this.OutputEntries[name].documentation;
            }

            switch (this.OutputEntries[name].type) {
                case "variable":
                case "type":
                    outputString += `var ${name};\n`;
                    break;

                case "array":
                    outputString += `var ${name} = [];\n`;
                    break;

                case "function":
                    outputString += `function ${name}() {};\n`;
                    break;

                case "enum":
                case "object":
                    outputString += outputStyleFunc(name, this.OutputEntries[name]);
                    break;

                case "class":
                case "interface":
                case "namespace":
                case "module":
                    outputString += outputStyleFunc(name, this.OutputEntries[name]);
                    break;

                default:
                    process.stderr.write(
                        `ERROR: unknown type: ${name} ${this.OutputEntries[name].type} ` +
                        "(report to https://github.com/WHUsoft/dts2externs/issues)"
                    );
                    break;
            } // switch

            outputString += "\n";

        } // for

        return outputString;
    }

    /**
     * True if this is visible outside this file, false otherwise
     * @param node
     */
    private IsNodeExported(node: ts.Node): boolean {
        return (
            (node.flags & ts.NodeFlags.Export) !== 0
            || (
                node.parent
                && node.parent.kind === ts.SyntaxKind.SourceFile
            )
        );
    }

    /**
     * True if node is "structured"
     * @param node
     */
    private IsNodeStructuredType(node: ts.Node): boolean {
        if (!node) { return false; }

        // Check for property signatures with anonymous type 
        if (node.kind === ts.SyntaxKind.PropertySignature) {
            let symbol = this.Checker.getSymbolAtLocation((<ts.PropertySignature> node).name);

            if (symbol) {
                let type = this.Checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
                if (
                    (
                        (symbol.flags & ts.SymbolFlags.Property) !== 0
                        || (symbol.flags & ts.SymbolFlags.Enum) !== 0
                    )
                    && (symbol.flags & ts.SymbolFlags.Transient) === 0
                    && (type.flags & ts.TypeFlags.Anonymous) !== 0
                ) {
                    return true;
                }
            }
        }

        // Check variable declarations with structured type
        if (node.kind === ts.SyntaxKind.VariableDeclaration) {
            let symbol = this.Checker.getSymbolAtLocation((<ts.VariableDeclaration> node).name);
            let type = this.Checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
            if ((type.flags & ts.TypeFlags.StructuredType) !== 0) {
                return true;
            }
        }

        // Skip abstracts
        if ((node.flags & ts.NodeFlags.Abstract) !== 0) {
            return false;
        }

        // Check for class / interface / module
        return (
            node.kind === ts.SyntaxKind.ClassDeclaration
            || node.kind === ts.SyntaxKind.InterfaceDeclaration
            || node.kind === ts.SyntaxKind.ModuleDeclaration
            || node.kind === ts.SyntaxKind.EnumDeclaration
        );
    }

    /**
     * Visited node gets checked and placed into OutputEntries 
     * @param node
     */
    private Visit(node: ts.Node): void {
        if (!node) { return; }

        // Never return if:
        // - current file is a d.ts file
        // - parsing of non-exported nodes is allowed
        // - node is exported
        if (
               !this.CurrentFileIsDts
            && !this.Options.parseNonExportedNodesInTsFiles
            && !this.IsNodeExported(node)
        ) {
            return;
        }

        if (this.IsNodeStructuredType(node)) {
            switch (node.kind) {
                case ts.SyntaxKind.ClassDeclaration:
                    this.OutputClassDeclaration(node);
                    break;

                case ts.SyntaxKind.ModuleDeclaration:
                    this.OutputModuleOrNamespaceDeclaration(node);
                    break;

                case ts.SyntaxKind.InterfaceDeclaration:
                    this.OutputInterfaceDeclaration(node);
                    break;

                case ts.SyntaxKind.EnumDeclaration:
                    this.OutputEnumDeclaration(node);
                    break;

                case ts.SyntaxKind.PropertySignature:
                    this.OutputPropertySignature(node);
                    break;

                // This is a "structured" variable as determined by isNodeStructuredType
                case ts.SyntaxKind.VariableDeclaration:
                    this.OutputStructuredVariableDeclaration(node);
                    break;

                default:
                    process.stderr.write(
                        `ERROR: unknown structured node: kind:${node.kind} type:${this.Checker.getTypeAtLocation(node).flags} ` +
                        "(report to https://github.com/WHUsoft/dts2externs/issues) :\n${node.getText()}\n"
                    );
                    break;
            }

            // outputStructuredVariableDeclaration has custom code to visit childnodes
            if (node.kind !== ts.SyntaxKind.VariableDeclaration) {
                ts.forEachChild(node, this.Visit.bind(this));
            }
        }
        else {
            switch (node.kind) {
                case ts.SyntaxKind.FunctionDeclaration:
                    this.OutputFunctionDeclaration(node);
                    break;

                case ts.SyntaxKind.VariableDeclaration:
                    this.OutputVariableDeclaration(node);
                    break;

                case ts.SyntaxKind.VariableStatement:
                    let declarations = (<ts.VariableStatement> node).declarationList.declarations;
                    for (let declaration of declarations) {
                        this.Visit(declaration);
                    }
                    break;
                case ts.SyntaxKind.ModuleBlock:
                    let statements = (<ts.ModuleBlock> node).statements;
                    for (let statement of statements) {
                        this.Visit(statement);
                    }
                    break;

                case ts.SyntaxKind.TypeAliasDeclaration:
                    this.OutputTypeAliasDeclaration(node);
                    break;

                default:
                    // skip node
                    break;
            }
        }
    }

    /**
     * Put ClassDeclaration node into Output
     * @param node
     */
    private OutputClassDeclaration(node: ts.Node): void {
        let symbol = this.Checker.getSymbolAtLocation((<ts.ClassDeclaration> node).name);
        // old crap
        // let baseTypes = this.Checker.getDeclaredTypeOfSymbol(symbol).getBaseTypes();
        // let extendType = baseTypes && baseTypes.length > 0 ? this.Checker.typeToString(baseTypes[0]) : "";

        this.OutputSymbol(symbol, "class");

        for (let member in symbol.members) {
            if (!symbol.members.hasOwnProperty(member)) { continue; }

            this.AddMember(symbol, symbol.members[member]);
        }
    }

    /**
     * Put ModuleDeclaration node into Output
     * @param node
     */
    private OutputModuleOrNamespaceDeclaration(node: ts.Node): void {
        let symbol = this.Checker.getSymbolAtLocation((<ts.ModuleDeclaration> node).name);

        let outputType: string;
        if ((node.flags & ts.NodeFlags.Namespace) !== 0) {
            outputType = "namespace";
        }
        else {
            outputType = "module";
        }

        this.OutputSymbol(symbol, outputType);
        for (let _symbol of this.Checker.getExportsOfModule(symbol)) {
            this.AddMember(symbol, _symbol);
        }
    }

    /**
     * Put InterfaceDeclaration node into Output
     * @param node
     */
    private OutputInterfaceDeclaration(node: ts.Node): void {
        let symbol = this.Checker.getSymbolAtLocation((<ts.InterfaceDeclaration> node).name);

        this.OutputSymbol(symbol, "interface");
        for (let member in symbol.members) {
            if (!symbol.members.hasOwnProperty(member)) { continue; }

            this.AddMember(symbol, symbol.members[member]);
        }
    }

    /**
     * Put EnumDeclaration node into Output
     * @param node
     */
    private OutputEnumDeclaration(node: ts.Node): void {
        let symbol = this.Checker.getSymbolAtLocation((<ts.EnumDeclaration> node).name);
        let type = this.Checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);

        this.OutputSymbol(symbol, "enum");

        for (let _symbol of type.getProperties()) {
            if ((_symbol.flags & ts.SymbolFlags.Value) !== 0 && (_symbol.flags & ts.SymbolFlags.Transient) === 0) {
                this.AddMember(symbol, _symbol);
            }
        }
    }

    /**
     * Put PropertySignature node into Output
     * @param node
     */
    private OutputPropertySignature(node: ts.Node): void {
        let symbol = this.Checker.getSymbolAtLocation((<ts.PropertySignature> node).name);
        let type = this.Checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);

        this.OutputSymbol(symbol, "object");

        for (let _symbol of type.getProperties()) {
            if ((_symbol.flags & ts.SymbolFlags.Property) !== 0 && (_symbol.flags & ts.SymbolFlags.Transient) === 0) {
                this.AddMember(symbol, _symbol);
            }
        }
    }

    /**
     * Put VariableDeclaration node into Output
     * @param node
     */
    private OutputStructuredVariableDeclaration(node: ts.Node): void {
        let symbol = this.Checker.getSymbolAtLocation((<ts.VariableDeclaration> node).name);
        let type = this.Checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);

        if (this.Checker.typeToString(type).search(/.*\[\]$/) !== -1) {
            this.OutputSymbol(symbol, "array");
            return;
        }

        this.OutputSymbol(symbol, "object");

        for (let _symbol of this.Checker.getPropertiesOfType(type)) {
            if ((_symbol.flags & ts.SymbolFlags.Transient) === 0) {
                this.AddMember(symbol, _symbol);
            }
        }
    }

    /**
     * Put FunctionDeclaration node into Output
     * @param node
     */
    private OutputFunctionDeclaration(node: ts.Node): void {
        let symbol = this.Checker.getSymbolAtLocation((<ts.FunctionDeclaration> node).name);

        this.OutputSymbol(symbol, "function");
    }

    /**
     * Put "normal" VariableDeclaration node into Output
     * @param node
     */
    private OutputVariableDeclaration(node: ts.Node): void {
        let symbol = this.Checker.getSymbolAtLocation((<ts.VariableDeclaration> node).name);
        let type = this.Checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);

        if ((type.flags & ts.TypeFlags.StructuredType) !== 0) {
            process.stderr.write("ERROR: ran into structured type whoops! (not your fault)");
        } else {
            this.OutputSymbol(symbol, "variable");
        }
    }

    /**
     * Put TypeAliasDeclaration node into Output
     * @param node
     */
    private OutputTypeAliasDeclaration(node: ts.Node): void {
        let symbol = this.Checker.getSymbolAtLocation((<ts.TypeAliasDeclaration> node).name);

        this.OutputSymbol(symbol, "type");
    }

    /**
     *  Put symbol into Output. Implements rules for overwriting existing Output entries
     * @param symbol
     * @param type
     */
    private OutputSymbol(symbol: ts.Symbol, type: string): void {
        if (!symbol.name) { return; }

        let name = symbol.name;
        name = name.replace(/[""]/g, "").replace(/[~\/\\]/g, "_");

        if (!this.OutputEntries[name]) {
            this.OutputEntries[name] = this.SerializeSymbol(symbol, type);
        }
        else {
            switch (this.OutputEntries[name].type) {
                case "type":
                case "variable":
                    if (
                        type !== "type"
                        && type !== "variable"
                    ) {
                        if (this.Options.debugOutput) {
                            process.stderr.write(
                                `INFO: already defined ${name} as "${this.OutputEntries[name].type}", ` +
                                `overwriting with: "${type}"`
                            );
                        }

                        this.OutputEntries[name].type = type;
                        this.OutputEntries[name].documentation = this.CommentsToString(symbol.getDocumentationComment());
                    }
                    break;

                case "function":
                case "array":
                    if (
                        type !== "function"
                        && type !== "array"
                        && type !== "type"
                        && type !== "variable"
                    ) {
                        if (this.Options.debugOutput) {
                            process.stderr.write(
                                `INFO: already defined ${name} as "${this.OutputEntries[name].type}", ` +
                                `overwriting with: "${type}"`
                            );
                        }

                        this.OutputEntries[name].type = type;
                        this.OutputEntries[name].documentation = this.CommentsToString(symbol.getDocumentationComment());
                    }
                    break;

                case "object":
                case "enum":
                    if (
                        type !== "object"
                        && type !== "enum"
                        && type !== "function"
                        && type !== "array"
                        && type !== "type"
                        && type !== "variable"
                    ) {
                        if (this.Options.debugOutput) {
                            process.stderr.write(
                                `INFO: already defined ${name} as "${this.OutputEntries[name].type}", ` +
                                `overwriting with: "${type}"`
                            );
                        }

                        this.OutputEntries[name].type = type;
                        this.OutputEntries[name].documentation = this.CommentsToString(symbol.getDocumentationComment());
                    }
                    break;

                default:
                    if (this.Options.debugOutput) {
                        process.stderr.write(
                            `INFO: already defined ${name} as ${this.OutputEntries[name].type}, ` +
                            `not overwriting with: ${type}`
                        );
                    }
                    break;
            }
        }
    }

    /**
     * Add member to previously output symbol
     * @param to
     * @param member
     */
    private AddMember(to: ts.Symbol, member: ts.Symbol): void {
        if (!to || !to.name || !member || !member.name) { return; }

        let name = to.name.replace(/[""]/g, "").replace(/[~\/\\]/g, "_");

        if (!this.OutputEntries[name]) {
            process.stderr.write(`ERROR: no entry for ${to.name} found - ${member.name}`);
        }

        this.OutputEntries[name].members[member.name] = this.SerializeSymbol(member, "member");
    }

    /**
     *  Serialize symbol into OutputEntry
     * @param name
     * @param type
     * @param symbol
     */
    private SerializeSymbol(symbol: ts.Symbol, type: string): IOutputEntry {
        return {
            documentation: this.CommentsToString(symbol.getDocumentationComment())
            , members: {}
            , type: type
        };
    }

    /**
     * Convert parsed comments to docstring for output
     * @param comments
     */
    private CommentsToString(comments: ts.SymbolDisplayPart[]) {
        let ds: string = "";
        if (comments && comments.length > 0) {
            ds += "/*";
            let text = comments.map(part => { return part.kind === "text" ? part.text : "\n"; }).join("");
            ds += text;
            ds += " */\n";
        }
        return ds;
    }
}
