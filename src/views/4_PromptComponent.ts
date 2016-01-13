import * as _ from "lodash";
import * as e from "../Enums";
import * as i from "../Interfaces";
import * as React from "react";
import AutocompleteComponent from "./AutocompleteComponent";
import DecorationToggleComponent from "./DecorationToggleComponent";
import History from "../History";
import {stopBubblingUp} from "./ViewUtils";
import JobComponent from "./3_JobComponent";
import PromptModel from "../Prompt";
const rx = require("rx");
const reactDOM = require("react-dom");


const keys = {
    goUp: (event: KeyboardEvent) => (event.ctrlKey && event.keyCode === 80) || event.keyCode === 38,
    goDown: (event: KeyboardEvent) => (event.ctrlKey && event.keyCode === 78) || event.keyCode === 40,
    enter: (event: KeyboardEvent) => event.keyCode === 13,
    tab: (event: KeyboardEvent) => event.keyCode === 9,
    deleteWord: (event: KeyboardEvent) => event.ctrlKey && event.keyCode === 87,
    interrupt: (event: KeyboardEvent) => event.ctrlKey && event.keyCode === 67,
};


function setCaretPosition(node: Node, position: number) {
    const selection = window.getSelection();
    const range = document.createRange();

    if (node.childNodes.length) {
        range.setStart(node.childNodes[0], position);
    } else {
        range.setStart(node, 0);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

function getCaretPosition(): number {
    return window.getSelection().anchorOffset;
}

function isCommandKey(event: KeyboardEvent) {
    return [16, 17, 18].includes(event.keyCode) || event.ctrlKey || event.altKey || event.metaKey;
}

const isSpecialKey = _.memoize(
    (event: React.KeyboardEvent) => _.some(_.values(keys),
                                           (matcher: (event: React.KeyboardEvent) => boolean) => matcher(event)),
    (event: React.KeyboardEvent) => [event.ctrlKey, event.keyCode]
);

// TODO: Figure out how it works.
function createEventHandler(): any {
    const subject: any = function () {
        subject.onNext.apply(subject, arguments);
    };

    function getEnumerablePropertyNames(target: _.Dictionary<any>) {
        const result: string[] = [];
        /* tslint:disable:forin */
        for (let key in target) {
            result.push(key);
        }
        return result;
    }

    getEnumerablePropertyNames(rx.Subject.prototype)
        .forEach(function (property) {
            subject[property] = rx.Subject.prototype[property];
        });
    rx.Subject.call(subject);

    return subject;
}

interface Props {
    status: e.Status;
    jobView: JobComponent;
    prompt: PromptModel;
    hasLocusOfAttention: boolean;
}

interface State {
    highlightedSuggestionIndex?: number;
    latestKeyCode?: number;
    suggestions?: i.Suggestion[];
}


// TODO: Make sure we only update the view when the model changes.
export default class PromptComponent extends React.Component<Props, State> implements KeyDownReceiver {
    private handlers: {
        onKeyDown: Function;
    };

    constructor(props: Props) {
        super(props);

        this.state = {
            suggestions: [],
            highlightedSuggestionIndex: 0,
            latestKeyCode: undefined,
        };

        const allKeys = createEventHandler();
        allKeys
            .filter(_.negate(isCommandKey))
            .forEach((event: KeyboardEvent) => this.setState({ latestKeyCode: event.keyCode }));


        const promptKeys = allKeys.filter(() => this.props.status !== e.Status.InProgress)
                                  .filter(isSpecialKey)
                                  .map(stopBubblingUp);
        promptKeys
            .filter(() => this.isAutocompleteShown())
            .filter(keys.tab)
            .forEach(() => this.applySuggestion());
        promptKeys
            .filter(keys.deleteWord).forEach(() => this.deleteWord());
        promptKeys
            .filter(keys.enter).forEach(() => this.execute());
        promptKeys
            .filter(keys.interrupt).forEach(() => {
                this.props.prompt.value = "";
                this.setDOMValueProgrammatically("");
            });
        promptKeys
            .filter((event: KeyboardEvent) => keys.goDown(event) || keys.goUp(event))
            .filter(() => this.isAutocompleteShown())
            .forEach((event: KeyboardEvent) => this.navigateAutocomplete(event));
        promptKeys
            .filter((event: KeyboardEvent) => keys.goDown(event) || keys.goUp(event))
            .filter(() => !this.isAutocompleteShown())
            .forEach((event: KeyboardEvent) => this.navigateHistory(event));

        this.handlers = {
            onKeyDown: allKeys
        };

        // FIXME: find a better design to propagate events.
        if (this.props.hasLocusOfAttention) {
            window.promptUnderAttention = this;
        }
    }

    handleKeyDown(event: KeyboardEvent): void {
        this.commandNode.focus();
    }

    componentDidMount() {
        $(reactDOM.findDOMNode(this)).fixedsticky();
        $(".fixedsticky-dummy").remove();

        this.commandNode.focus();
    }

    componentDidUpdate(prevProps: Props, prevState: State) {
        if (this.props.status !== e.Status.NotStarted) {
            return;
        }

        if (!prevProps.hasLocusOfAttention && this.props.hasLocusOfAttention) {
            this.commandNode.focus();
        }

        // FIXME: find a better design to propagate events.
        if (this.props.hasLocusOfAttention) {
            window.promptUnderAttention = this;
        }
    }

    render() {
        const classes = ["prompt-wrapper", "fixedsticky", this.props.status].join(" ");
        let autocomplete: React.ReactElement<any>;
        let decorationToggle: React.ReactElement<any>;
        let scrollToTop: React.ReactElement<any>;

        if (this.showAutocomplete()) {
            autocomplete = React.createElement(AutocompleteComponent, {
                suggestions: this.state.suggestions,
                caretOffset: $(this.commandNode).caret("offset"),
                onSuggestionHover: this.highlightSuggestion.bind(this),
                onSuggestionClick: this.applySuggestion.bind(this),
                highlightedIndex: this.state.highlightedSuggestionIndex,
                ref: "autocomplete",
            });
        }

        if (this.props.jobView.state.canBeDecorated) {
            decorationToggle = React.createElement(DecorationToggleComponent, { job: this.props.jobView });
        }

        if (this.props.status !== e.Status.NotStarted) {
            scrollToTop = React.createElement(
                "a",
                { href: "#", className: "scroll-to-top", onClick: this.handleScrollToTop.bind(this) },
                React.createElement("i", { className: "fa fa-long-arrow-up" })
            );
        }

        return React.createElement(
            "div",
            { className: classes },
            React.createElement(
                "div",
                { className: "prompt-decoration" },
                React.createElement("div", { className: "arrow" })
            ),
            React.createElement("div", { className: "prompt-info", title: this.props.status }),
            React.createElement("div", {
                className: "prompt",
                onKeyDown: this.handlers.onKeyDown.bind(this),
                onInput: this.handleInput.bind(this),
                onKeyPress: this.handleKeyPress.bind(this),
                type: "text",
                ref: "command",
                                                                           // Without the InProgress part the alternate buffer loses focus.
                contentEditable: this.props.status === e.Status.NotStarted || this.props.status === e.Status.InProgress,
            }),
            autocomplete,
            React.createElement(
                "div",
                { className: "actions" },
                decorationToggle,
                scrollToTop
            )
        );
    }

    private execute(): void {
        if (!this.isEmpty()) {
            // Timeout prevents two-line input on cd.
            setTimeout(() => this.props.prompt.execute(), 0);
        }
    }

    private get commandNode(): HTMLInputElement {
        /* tslint:disable:no-string-literal */
        return <HTMLInputElement>this.refs["command"];
    }

    private setDOMValueProgrammatically(text: string): void {
        this.commandNode.innerText = text;
        setCaretPosition(this.commandNode, text.length);

        this.forceUpdate();
    }

    private deleteWord(current = this.props.prompt.value, position = getCaretPosition()): void {
        if (!current.length) {
            return;
        }

        const lastIndex = current.substring(0, position).lastIndexOf(" ");
        const endsWithASpace =  lastIndex === current.length - 1;

        current = current.substring(0, lastIndex);

        if (endsWithASpace) {
            this.deleteWord(current, position);
        } else {
            if (current.length) {
                current += " ";
            }

            this.props.prompt.value = current + this.props.prompt.value.substring(getCaretPosition());
            this.setDOMValueProgrammatically(this.props.prompt.value);
        }
    }

    private isEmpty(): boolean {
        return this.props.prompt.value.replace(/\s/g, "").length === 0;
    }

    private navigateHistory(event: KeyboardEvent): void {
        if (keys.goUp(event)) {
            let previous = History.getPrevious();
            this.props.prompt.value = previous;
            this.setDOMValueProgrammatically(previous);
        } else {
            let next = History.getNext();
            this.props.prompt.value = next;
            this.setDOMValueProgrammatically(next);
        }
    }

    private highlightSuggestion(index: number): void {
        this.setState({highlightedSuggestionIndex: index});
    }

    private navigateAutocomplete(event: KeyboardEvent): void {
        let index: number;
        if (keys.goUp(event)) {
            index = Math.max(0, this.state.highlightedSuggestionIndex - 1);
        } else {
            index = Math.min(this.state.suggestions.length - 1, this.state.highlightedSuggestionIndex + 1);
        }

        this.highlightSuggestion(index);
    }

    private applySuggestion(): void {
        let state = this.state;
        const suggestion = state.suggestions[state.highlightedSuggestionIndex];

        if (suggestion.replaceEverything) {
            this.props.prompt.value = suggestion.value;
            this.setDOMValueProgrammatically(suggestion.value);
        } else {
            this.props.prompt.replaceCurrentLexeme(suggestion);
            if (!suggestion.partial) {
                this.props.prompt.value += " ";
            }

            this.setDOMValueProgrammatically(this.props.prompt.value);
        }

        this.props.prompt.getSuggestions().then(suggestions =>
            this.setState({ suggestions: suggestions, highlightedSuggestionIndex: 0 })
        );
    }

    private showAutocomplete(): boolean {
        // TODO: use streams.
        return this.props.hasLocusOfAttention &&
            this.state.suggestions.length &&
            this.commandNode && !this.isEmpty() &&
            this.props.status === e.Status.NotStarted && ![13, 27].includes(this.state.latestKeyCode);
    }

    private isAutocompleteShown(): boolean {
        /* tslint:disable:no-string-literal */
        return !!this.refs["autocomplete"];
    }

    private handleInput(event: React.SyntheticEvent) {
        this.props.prompt.value = (<HTMLElement>event.target).innerText;

        // TODO: remove repetition.
        // TODO: make it a stream.
        this.props.prompt.getSuggestions().then(suggestions =>
            this.setState({ suggestions: suggestions, highlightedSuggestionIndex: 0 })
        );
    }

    private handleScrollToTop(event: Event) {
        stopBubblingUp(event);

        const offset = $(reactDOM.findDOMNode(this.props.jobView)).offset().top - 10;
        $("html, body").animate({ scrollTop: offset }, 300);
    }

    private handleKeyPress(event: Event) {
        if (this.props.status === e.Status.InProgress) {
            stopBubblingUp(event);
        }
    }
}
