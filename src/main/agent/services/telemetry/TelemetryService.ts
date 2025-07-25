import { PostHog } from 'posthog-node'
import { version as extensionVersion } from '../../../../../package.json'

import type { TaskFeedbackType } from '@shared/WebviewMessage'
import type { BrowserSettings } from '@shared/BrowserSettings'
import os from 'os'
import crypto from 'crypto'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

/**
 * PostHogClient handles telemetry event tracking for the Cline extension
 * Uses PostHog analytics to track user interactions and system events
 * Respects user privacy settings and VSCode's global telemetry configuration
 */
class PostHogClient {
  // Event constants for tracking user interactions and system events
  private static readonly EVENTS = {
    USER: {
      // Tracks when the user opts out of telemetry
      OPT_OUT: 'user.opt_out',
      // Tracks when the app is started
      APP_STARTED: 'user.app_started',
      // Tracks when the app is launched for the first time after installation
      APP_FIRST_LAUNCH: 'user.app_first_launch'
    },
    // Task-related events for tracking conversation and execution flow
    TASK: {
      // Tracks when a new task/conversation is started
      CREATED: 'task.created',
      // Tracks when a task is reopened
      RESTARTED: 'task.restarted',
      // Tracks when a task is finished, with acceptance or rejection status
      COMPLETED: 'task.completed',
      // Tracks user feedback on completed tasks
      FEEDBACK: 'task.feedback',
      // Tracks when a message is sent in a conversation
      API_REQUEST: 'task.api_request',
      // Tracks token consumption for cost and usage analysis
      TOKEN_USAGE: 'task.tokens',
      // Tracks switches between plan and act modes
      MODE_SWITCH: 'task.mode',
      // Tracks when users select an option from AI-generated followup questions
      OPTION_SELECTED: 'task.option_selected',
      // Tracks when users type a custom response instead of selecting an option from AI-generated followup questions
      OPTIONS_IGNORED: 'task.options_ignored',
      // Tracks usage of the git-based checkpoint system (shadow_git_initialized, commit_created, branch_created, branch_deleted_active, branch_deleted_inactive, restored)
      CHECKPOINT_USED: 'task.checkpoint_used',
      // Tracks when tools (like file operations, commands) are used
      TOOL_USED: 'task.tool_used',
      // Tracks when a historical task is loaded from storage
      HISTORICAL_LOADED: 'task.historical_loaded',
      // Tracks when the retry button is clicked for failed operations
      RETRY_CLICKED: 'task.retry_clicked',
      // Tracks when a diff edit (replace_in_file) operation fails
      DIFF_EDIT_FAILED: 'task.diff_edit_failed',
      // Tracks when the browser tool is started
      BROWSER_TOOL_START: 'task.browser_tool_start',
      // Tracks when the browser tool is completed
      BROWSER_TOOL_END: 'task.browser_tool_end',
      // Tracks when browser errors occur
      BROWSER_ERROR: 'task.browser_error'
    },
    // UI interaction events for tracking user engagement
    UI: {
      // Tracks when user switches between API providers
      PROVIDER_SWITCH: 'ui.provider_switch',
      // Tracks when images are attached to a conversation
      IMAGE_ATTACHED: 'ui.image_attached',
      // Tracks general button click interactions
      BUTTON_CLICK: 'ui.button_click',
      // Tracks when the marketplace view is opened
      MARKETPLACE_OPENED: 'ui.marketplace_opened',
      // Tracks when settings panel is opened
      SETTINGS_OPENED: 'ui.settings_opened',
      // Tracks when task history view is opened
      HISTORY_OPENED: 'ui.history_opened',
      // Tracks when a task is removed from history
      TASK_POPPED: 'ui.task_popped',
      // Tracks when a different model is selected
      MODEL_SELECTED: 'ui.model_selected',
      // Tracks when planning mode is toggled on
      PLAN_MODE_TOGGLED: 'ui.plan_mode_toggled',
      // Tracks when action mode is toggled on
      ACT_MODE_TOGGLED: 'ui.act_mode_toggled',
      // Tracks when users use the "favorite" button in the model picker
      MODEL_FAVORITE_TOGGLED: 'ui.model_favorite_toggled'
    }
  }

  /** Singleton instance of the PostHogClient */
  private static instance: PostHogClient
  /** PostHog client instance for sending analytics events */
  private client: PostHog
  /** Unique identifier for the current user */
  private distinctId: string = generatePersistentMachineId()
  /** Whether telemetry is currently enabled based on user and VSCode settings */
  private telemetryEnabled: boolean = false
  /** Current version of the extension */
  private readonly version: string = extensionVersion

  /**
   * Private constructor to enforce singleton pattern
   * Initializes PostHog client with configuration
   */
  private constructor() {
    this.client = new PostHog('phc_soaFIGBpywruW8dckk93xUs0FGn2otNi5CUkEbd2a4U', {
      host: 'https://us.i.posthog.com'
    })
  }

  /**
   * @param didUserOptIn Whether the user has explicitly opted into telemetry
   */
  public updateTelemetryState(didUserOptIn: boolean): void {
    this.telemetryEnabled = false

    this.telemetryEnabled = didUserOptIn

    // Update PostHog client state based on telemetry preference
    if (this.telemetryEnabled) {
      this.client.optIn()
      this.client.identify({ distinctId: this.distinctId })
    } else {
      this.capture({ event: PostHogClient.EVENTS.USER.OPT_OUT })
      this.client.optOut()
    }
  }

  /**
   * Gets or creates the singleton instance of PostHogClient
   * @returns The PostHogClient instance
   */
  public static getInstance(): PostHogClient {
    if (!PostHogClient.instance) {
      PostHogClient.instance = new PostHogClient()
    }
    return PostHogClient.instance
  }

  /**
   * Captures a telemetry event if telemetry is enabled
   * @param event The event to capture with its properties
   */
  public capture(event: { event: string; properties?: any }): void {
    if (this.telemetryEnabled) {
      const propertiesWithVersion = {
        ...event.properties,
        extension_version: this.version,
        is_dev: process.env.IS_DEV
      }
      console.log('[PostHog] Capturing event properties:', propertiesWithVersion)
      this.client.capture({
        distinctId: this.distinctId,
        event: event.event,
        properties: propertiesWithVersion
      })
    }
  }

  // User events
  /**
   * Records when the app is started
   */
  public captureAppStarted() {
    this.capture({
      event: PostHogClient.EVENTS.USER.APP_STARTED,
      properties: {
        timestamp: new Date().toISOString(),
        platform: process.platform,
        architecture: process.arch
      }
    })
  }

  /**
   * Records when the app is launched for the first time after installation
   */
  public captureAppFirstLaunch() {
    this.capture({
      event: PostHogClient.EVENTS.USER.APP_FIRST_LAUNCH,
      properties: {
        timestamp: new Date().toISOString(),
        platform: process.platform,
        architecture: process.arch,
        version: this.version
      }
    })
  }

  // Task events
  /**
   * Records when a new task/conversation is started
   * @param taskId Unique identifier for the new task
   */
  public captureTaskCreated(taskId: string, apiProvider?: string) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.CREATED,
      properties: { taskId, apiProvider }
    })
  }

  /**
   * Records when a task/conversation is restarted
   * @param taskId Unique identifier for the new task
   */
  public captureTaskRestarted(taskId: string, apiProvider?: string) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.RESTARTED,
      properties: { taskId, apiProvider }
    })
  }

  /**
   * Records when cline calls the task completion_result tool signifying that cline is done with the task
   * @param taskId Unique identifier for the task
   */
  public captureTaskCompleted(taskId: string) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.COMPLETED,
      properties: { taskId }
    })
  }

  /**
   * Captures that a message was sent, and includes the API provider and model used
   * @param taskId Unique identifier for the task
   * @param provider The API provider (e.g., OpenAI, Anthropic)
   * @param model The specific model used (e.g., GPT-4, Claude)
   * @param source The source of the message ("user" | "model"). Used to track message patterns and identify when users need to correct the model's responses.
   */
  public captureApiRequestEvent(
    taskId: string,
    provider: string = 'unknown',
    model: string = 'unknown',
    source: 'user' | 'assistant',
    mode: 'chat' | 'cmd' | 'agent'
  ) {
    // Ensure required parameters are provided
    if (!taskId || !provider || !model || !source || !mode) {
      console.warn('TelemetryService: Missing required parameters for message capture')
      return
    }

    const properties: Record<string, any> = {
      taskId,
      provider,
      model,
      source,
      mode,
      timestamp: new Date().toISOString() // Add timestamp for message sequencing
    }

    this.capture({
      event: PostHogClient.EVENTS.TASK.API_REQUEST,
      properties
    })
  }

  /**
   * TODO
   * Records token usage metrics for cost tracking and usage analysis
   * @param taskId Unique identifier for the task
   * @param tokensIn Number of input tokens consumed
   * @param tokensOut Number of output tokens generated
   * @param model The model used for token calculation
   */
  public captureTokenUsage(taskId: string, tokensIn: number, tokensOut: number, model: string) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.TOKEN_USAGE,
      properties: {
        taskId,
        tokensIn,
        tokensOut,
        model
      }
    })
  }

  /**
   * Records when a task switches between plan and act modes
   * @param taskId Unique identifier for the task
   * @param mode The mode being switched to (plan or act)
   */
  public captureModeSwitch(taskId: string, mode: 'plan' | 'act') {
    this.capture({
      event: PostHogClient.EVENTS.TASK.MODE_SWITCH,
      properties: {
        taskId,
        mode
      }
    })
  }

  /**
   * Records user feedback on completed tasks
   * @param taskId Unique identifier for the task
   * @param feedbackType The type of feedback ("thumbs_up" or "thumbs_down")
   */
  public captureTaskFeedback(taskId: string, feedbackType: TaskFeedbackType) {
    console.info('TelemetryService: Capturing task feedback', { taskId, feedbackType })
    this.capture({
      event: PostHogClient.EVENTS.TASK.FEEDBACK,
      properties: {
        taskId,
        feedbackType
      }
    })
  }

  // Tool events
  /**
   * Records when a tool is used during task execution
   * @param taskId Unique identifier for the task
   * @param tool Name of the tool being used
   * @param autoApproved Whether the tool was auto-approved based on settings
   * @param success Whether the tool execution was successful
   */
  public captureToolUsage(taskId: string, tool: string, autoApproved: boolean, success: boolean) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.TOOL_USED,
      properties: {
        taskId,
        tool,
        autoApproved,
        success
      }
    })
  }

  /**
   * Records interactions with the git-based checkpoint system
   * @param taskId Unique identifier for the task
   * @param action The type of checkpoint action
   * @param durationMs Optional duration of the operation in milliseconds
   */
  public captureCheckpointUsage(
    taskId: string,
    action: 'shadow_git_initialized' | 'commit_created' | 'restored' | 'diff_generated',
    durationMs?: number
  ) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.CHECKPOINT_USED,
      properties: {
        taskId,
        action,
        durationMs
      }
    })
  }

  // UI events
  /**
   * Records when the user switches between different API providers
   * @param from Previous provider name
   * @param to New provider name
   * @param location Where the switch occurred (settings panel or bottom bar)
   * @param taskId Optional task identifier if switch occurred during a task
   */
  public captureProviderSwitch(from: string, to: string, location: 'settings' | 'bottom', taskId?: string) {
    this.capture({
      event: PostHogClient.EVENTS.UI.PROVIDER_SWITCH,
      properties: {
        from,
        to,
        location,
        taskId
      }
    })
  }

  /**
   * Records when images are attached to a conversation
   * @param taskId Unique identifier for the task
   * @param imageCount Number of images attached
   */
  public captureImageAttached(taskId: string, imageCount: number) {
    this.capture({
      event: PostHogClient.EVENTS.UI.IMAGE_ATTACHED,
      properties: {
        taskId,
        imageCount
      }
    })
  }

  /**
   * Records general button click interactions in the UI
   * @param button Identifier for the button that was clicked
   * @param taskId Optional task identifier if click occurred during a task
   * @param properties Optional additional properties to include with the event
   */
  public captureButtonClick(button: string, taskId?: string, properties?: Record<string, any>) {
    this.capture({
      event: PostHogClient.EVENTS.UI.BUTTON_CLICK,
      properties: {
        button,
        taskId,
        ...(properties || {})
      }
    })
  }

  /**
   * Records when the marketplace view is opened
   * @param taskId Optional task identifier if marketplace was opened during a task
   */
  public captureMarketplaceOpened(taskId?: string) {
    this.capture({
      event: PostHogClient.EVENTS.UI.MARKETPLACE_OPENED,
      properties: {
        taskId
      }
    })
  }

  /**
   * Records when the settings panel is opened
   * @param taskId Optional task identifier if settings were opened during a task
   */
  public captureSettingsOpened(taskId?: string) {
    this.capture({
      event: PostHogClient.EVENTS.UI.SETTINGS_OPENED,
      properties: {
        taskId
      }
    })
  }

  /**
   * Records when the task history view is opened
   * @param taskId Optional task identifier if history was opened during a task
   */
  public captureHistoryOpened(taskId?: string) {
    this.capture({
      event: PostHogClient.EVENTS.UI.HISTORY_OPENED,
      properties: {
        taskId
      }
    })
  }

  /**
   * Records when a task is removed from the task history
   * @param taskId Unique identifier for the task being removed
   */
  public captureTaskPopped(taskId: string) {
    this.capture({
      event: PostHogClient.EVENTS.UI.TASK_POPPED,
      properties: {
        taskId
      }
    })
  }

  /**
   * Records when a diff edit (replace_in_file) operation fails
   * @param taskId Unique identifier for the task
   * @param errorType Type of error that occurred (e.g., "search_not_found", "invalid_format")
   */
  public captureDiffEditFailure(taskId: string, errorType?: string) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.DIFF_EDIT_FAILED,
      properties: {
        taskId,
        errorType
      }
    })
  }

  /**
   * Records when a different model is selected for use
   * @param model Name of the selected model
   * @param provider Provider of the selected model
   * @param taskId Optional task identifier if model was selected during a task
   */
  public captureModelSelected(model: string, provider: string, taskId?: string) {
    this.capture({
      event: PostHogClient.EVENTS.UI.MODEL_SELECTED,
      properties: {
        model,
        provider,
        taskId
      }
    })
  }

  /**
   * Records when a historical task is loaded from storage
   * @param taskId Unique identifier for the historical task
   */
  public captureHistoricalTaskLoaded(taskId: string) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.HISTORICAL_LOADED,
      properties: {
        taskId
      }
    })
  }

  /**
   * Records when the retry button is clicked for failed operations
   * @param taskId Unique identifier for the task being retried
   */
  public captureRetryClicked(taskId: string) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.RETRY_CLICKED,
      properties: {
        taskId
      }
    })
  }

  /**
   * Records when the browser tool is started
   * @param taskId Unique identifier for the task
   * @param browserSettings The browser settings being used
   */
  public captureBrowserToolStart(taskId: string, browserSettings: BrowserSettings) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.BROWSER_TOOL_START,
      properties: {
        taskId,
        viewport: browserSettings.viewport,
        isRemote: !!browserSettings.remoteBrowserEnabled,
        remoteBrowserHost: browserSettings.remoteBrowserHost,
        timestamp: new Date().toISOString()
      }
    })
  }

  /**
   * Records when the browser tool is completed
   * @param taskId Unique identifier for the task
   * @param stats Statistics about the browser session
   */
  public captureBrowserToolEnd(
    taskId: string,
    stats: {
      actionCount: number
      duration: number
      actions?: string[]
    }
  ) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.BROWSER_TOOL_END,
      properties: {
        taskId,
        actionCount: stats.actionCount,
        duration: stats.duration,
        actions: stats.actions,
        timestamp: new Date().toISOString()
      }
    })
  }

  /**
   * Records when browser errors occur during a task
   * @param taskId Unique identifier for the task
   * @param errorType Type of error that occurred (e.g., "launch_error", "connection_error", "navigation_error")
   * @param errorMessage The error message
   * @param context Additional context about where the error occurred
   */
  public captureBrowserError(
    taskId: string,
    errorType: string,
    errorMessage: string,
    context?: {
      action?: string
      url?: string
      isRemote?: boolean
      [key: string]: any
    }
  ) {
    this.capture({
      event: PostHogClient.EVENTS.TASK.BROWSER_ERROR,
      properties: {
        taskId,
        errorType,
        errorMessage,
        context,
        timestamp: new Date().toISOString()
      }
    })
  }

  /**
   * Records when a user selects an option from AI-generated followup questions
   * @param taskId Unique identifier for the task
   * @param qty The quantity of options that were presented
   * @param mode The mode in which the option was selected ("plan" or "act")
   */
  public captureOptionSelected(taskId: string, qty: number, mode: 'plan' | 'act') {
    this.capture({
      event: PostHogClient.EVENTS.TASK.OPTION_SELECTED,
      properties: {
        taskId,
        qty,
        mode
      }
    })
  }

  /**
   * Records when a user types a custom response instead of selecting one of the AI-generated followup questions
   * @param taskId Unique identifier for the task
   * @param qty The quantity of options that were presented
   * @param mode The mode in which the custom response was provided ("plan" or "act")
   */
  public captureOptionsIgnored(taskId: string, qty: number, mode: 'plan' | 'act') {
    this.capture({
      event: PostHogClient.EVENTS.TASK.OPTIONS_IGNORED,
      properties: {
        taskId,
        qty,
        mode
      }
    })
  }

  /**
   * Records when the user uses the model favorite button in the model picker
   * @param model The name of the model the user has interacted with
   * @param isFavorited Whether the model is being favorited (true) or unfavorited (false)
   */
  public captureModelFavoritesUsage(model: string, isFavorited: boolean) {
    this.capture({
      event: PostHogClient.EVENTS.UI.MODEL_FAVORITE_TOGGLED,
      properties: {
        model,
        isFavorited
      }
    })
  }

  public isTelemetryEnabled(): boolean {
    return this.telemetryEnabled
  }

  public async shutdown(): Promise<void> {
    await this.client.shutdown()
  }
}
/**
 * Generates a persistent machine identifier
 * Generates a unique and persistent identifier based on machine hardware and system information
 */
function generatePersistentMachineId(): string {
  const userDataPath = app.getPath('userData')
  const machineIdPath = path.join(userDataPath, '.machine-id')

  // Try to read existing machine ID
  try {
    if (fs.existsSync(machineIdPath)) {
      const existingId = fs.readFileSync(machineIdPath, 'utf8').trim()
      if (existingId && existingId.length > 0) {
        return existingId
      }
    }
  } catch (error) {
    console.warn('Failed to read existing machine ID:', error)
  }

  // Generate new machine ID
  const machineInfo = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    userInfo: os.userInfo().username,
    // Get MAC address of the first non-internal network interface
    macAddress: getMacAddress(),
    // Add some randomness to ensure uniqueness
    random: Math.random().toString(36).substr(2, 9)
  }

  // Create hash based on machine information
  const hash = crypto.createHash('sha256')
  hash.update(JSON.stringify(machineInfo))
  const machineId = 'chaterm-' + hash.digest('hex').substr(0, 32)

  // Save to file
  try {
    // Ensure directory exists
    fs.mkdirSync(path.dirname(machineIdPath), { recursive: true })
    fs.writeFileSync(machineIdPath, machineId, 'utf8')
  } catch (error) {
    console.warn('Failed to save machine ID:', error)
  }

  return machineId
}

/**
 * Checks if this is the first launch
 * Determines by checking the first launch flag file
 */
export function checkIsFirstLaunch(): boolean {
  const userDataPath = app.getPath('userData')
  const firstLaunchFlagPath = path.join(userDataPath, '.first-launch-completed')

  try {
    // If the file does not exist, it is the first launch
    if (!fs.existsSync(firstLaunchFlagPath)) {
      // Create the flag file to indicate the first launch is complete
      fs.mkdirSync(path.dirname(firstLaunchFlagPath), { recursive: true })
      fs.writeFileSync(firstLaunchFlagPath, new Date().toISOString(), 'utf8')
      return true
    }
    return false
  } catch (error) {
    console.warn('Failed to check first launch status:', error)
    return false
  }
}

/**
 * Helper function to get MAC address
 */
function getMacAddress(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name]
    if (nets) {
      for (const net of nets) {
        // Skip internal interfaces and invalid MAC addresses
        if (!net.internal && net.mac !== '00:00:00:00:00:00') {
          return net.mac
        }
      }
    }
  }
  return 'unknown-mac'
}
export const telemetryService = PostHogClient.getInstance()
